// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Client } from "./ccip/Client.sol";
import { IRouterClient } from "./ccip/IRouterClient.sol";
import { ITokenAdminRegistry, ITokenPool } from "./ccip/ITokenAdminRegistry.sol";
import { IHederaScheduleService } from "./interfaces/IHederaScheduleService.sol";

/**
 * @title CrossChainPayroll
 * @notice A Hedera treasury that pays a fixed list of payees every `interval`, each on the chain they choose:
 *         on Hedera with a plain token transfer, or on another chain through Chainlink CCIP.
 *
 * How a run works:
 *  1. The owner funds the contract with the payout token and with HBAR. CCIP fees are paid in native HBAR, so the
 *     treasury never needs LINK.
 *  2. `run` pays every active payee. A payout that cannot be made (not enough tokens or HBAR, or CCIP rejects it) is
 *     skipped with a `PayoutSkipped` event instead of reverting, so one bad payee never blocks everyone else.
 *  3. `run` then asks the Hedera Schedule Service (HIP-1215) to call `run` again at the next due time. The network
 *     executes that call itself: no keeper, cron or bot. `run` stays permissionless once a run is due, so a missed
 *     schedule (throttled second, empty fee balance) is recovered by anyone calling it.
 *
 * Who can do what: the owner manages payees and the schedule and can withdraw the treasury. Anyone can trigger a due
 * run, but cannot change who is paid or how much.
 *
 * Units: token amounts use the payout token's decimals. HBAR amounts inside the EVM (fees, balances) are tinybars.
 */
contract CrossChainPayroll is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice `chainSelector` value meaning "pay on Hedera itself" (CCIP chain selectors are never 0).
    uint64 public constant HEDERA = 0;
    uint256 public constant MAX_PAYEES = 20;
    uint256 public constant MIN_INTERVAL = 60;
    /// @notice Gas budget for the scheduled `run`. Hedera charges at least 80% of a transaction's gas limit, so these
    ///         are measured on testnet rather than padded: creating the next schedule through the Schedule Service
    ///         costs a flat ~1.41M gas whatever the scheduled call's own limit, and a CCIP payout ~350k.
    uint256 public constant RUN_BASE_GAS = 150_000;
    uint256 public constant SCHEDULE_NEXT_GAS = 1_450_000;
    uint256 public constant LOCAL_PAYOUT_GAS = 60_000;
    uint256 public constant CCIP_PAYOUT_GAS = 450_000;
    /// @notice On Hedera, `block.timestamp` is the start of the ~2s block a transaction lands in, so a call the network
    ///         executes at second T can observe T-2. Scheduling a few seconds after `nextRunAt` keeps `run` due.
    uint256 public constant SCHEDULE_DELAY = 10;
    /// @notice If the target second has no schedule capacity, try the following seconds up to this many.
    uint256 public constant CAPACITY_SEARCH = 10;

    IHederaScheduleService internal constant HSS = IHederaScheduleService(address(0x16b));
    int64 internal constant HSS_SUCCESS = 22;

    IRouterClient public immutable router;
    IERC20 public immutable token;
    /// @notice CCIP's registry of token pools, used to check that the payout token can travel to a payee's chain.
    ITokenAdminRegistry public immutable tokenAdminRegistry;

    struct Payee {
        address account;
        uint64 chainSelector;
        bool active;
        uint256 amount;
        string label;
    }

    enum SkipReason {
        InsufficientTokens,
        InsufficientHbar,
        QuoteFailed,
        SendFailed
    }

    Payee[] internal _payees;
    uint256 public interval;
    uint256 public nextRunAt;
    uint256 public runCount;
    bool public paused;
    /// @notice The Hedera schedule entity that will execute the next run (address(0) when none is pending).
    address public schedule;
    /// @notice The consensus second `schedule` executes at. Inside that execution `block.timestamp` can read up to ~2s
    ///         earlier (the start of its block), which is why scheduled runs are recognised by their caller instead.
    uint256 public scheduledAt;

    event PayeeAdded(uint256 indexed id, address indexed account, uint64 chainSelector, uint256 amount, string label);
    event PayeeUpdated(uint256 indexed id, uint256 amount, bool active);
    event IntervalChanged(uint256 interval);
    event Started(uint256 nextRunAt);
    event Paused();
    /// @param byScheduleService true when the Hedera Schedule Service executed the run (it calls as this contract)
    event RunExecuted(uint256 indexed runId, uint256 paid, uint256 skipped, uint256 nextRunAt, bool byScheduleService);
    event PayoutSent(
        uint256 indexed runId,
        uint256 indexed payeeId,
        address indexed account,
        uint64 chainSelector,
        uint256 amount,
        bytes32 messageId,
        uint256 fee
    );
    event PayoutSkipped(uint256 indexed runId, uint256 indexed payeeId, SkipReason reason);
    event RunScheduled(uint256 at, address schedule, uint256 gasLimit);
    event ScheduleFailed(uint256 at, int64 responseCode);
    /// @param deleted false when the schedule had already executed (the usual case inside a scheduled run)
    event ScheduleCancelled(address schedule, bool deleted);
    event Withdrawn(address indexed asset, address indexed to, uint256 amount);

    error ZeroAddress();
    error UnsupportedChain(uint64 chainSelector);
    error TooManyPayees();
    error UnknownPayee(uint256 id);
    error IntervalTooShort();
    error NotDue(uint256 nextRunAt);
    error IsPaused();
    error TransferFailed();

    constructor(IRouterClient router_, IERC20 token_, ITokenAdminRegistry tokenAdminRegistry_, uint256 interval_)
        Ownable(msg.sender)
    {
        if (
            address(router_) == address(0) || address(token_) == address(0)
                || address(tokenAdminRegistry_) == address(0)
        ) revert ZeroAddress();
        if (interval_ < MIN_INTERVAL) revert IntervalTooShort();
        router = router_;
        token = token_;
        tokenAdminRegistry = tokenAdminRegistry_;
        interval = interval_;
        paused = true;
    }

    /// @notice HBAR sent here funds CCIP fees and the scheduled runs.
    receive() external payable { }

    /*//////////////////////////////////////////////////////////////
                                 PAYEES
    //////////////////////////////////////////////////////////////*/

    /// @param chainSelector `HEDERA` (0) to pay on Hedera, otherwise the CCIP selector of the destination chain. Both
    ///        the router and the payout token's pool must support that chain: a lane the router knows but the token's
    ///        pool does not would make every payout fail with `ChainNotAllowed`.
    function addPayee(address account, uint64 chainSelector, uint256 amount, string calldata label)
        external
        onlyOwner
        returns (uint256 id)
    {
        if (account == address(0)) revert ZeroAddress();
        if (_payees.length == MAX_PAYEES) revert TooManyPayees();
        if (chainSelector != HEDERA && !canPayOn(chainSelector)) revert UnsupportedChain(chainSelector);
        id = _payees.length;
        _payees.push(
            Payee({ account: account, chainSelector: chainSelector, active: true, amount: amount, label: label })
        );
        emit PayeeAdded(id, account, chainSelector, amount, label);
    }

    /// @notice Change a payee's amount or pause them. To change where someone is paid, deactivate and add again.
    function updatePayee(uint256 id, uint256 amount, bool active) external onlyOwner {
        if (id >= _payees.length) revert UnknownPayee(id);
        Payee storage p = _payees[id];
        p.amount = amount;
        p.active = active;
        emit PayeeUpdated(id, amount, active);
    }

    function setInterval(uint256 interval_) external onlyOwner {
        if (interval_ < MIN_INTERVAL) revert IntervalTooShort();
        interval = interval_;
        emit IntervalChanged(interval_);
    }

    /*//////////////////////////////////////////////////////////////
                                SCHEDULE
    //////////////////////////////////////////////////////////////*/

    /// @notice Starts (or restarts) payroll with the first run at `firstRunAt` and schedules it.
    function start(uint256 firstRunAt) external onlyOwner {
        _cancelSchedule();
        paused = false;
        nextRunAt = firstRunAt > block.timestamp ? firstRunAt : block.timestamp;
        emit Started(nextRunAt);
        _scheduleNextRun();
    }

    /// @notice Stops payroll and deletes the pending schedule so it does not burn HBAR on a run that would revert.
    function pause() external onlyOwner {
        paused = true;
        _cancelSchedule();
        emit Paused();
    }

    /// @notice Pays every active payee and schedules the next run. Called by the Hedera Schedule Service at
    ///         `nextRunAt`; permissionless once due so a missed schedule never stops payroll.
    function run() external nonReentrant {
        if (paused) revert IsPaused();
        if (block.timestamp < nextRunAt) revert NotDue(nextRunAt);

        uint256 runId = ++runCount;
        uint256 paid;
        uint256 skipped;
        for (uint256 id; id < _payees.length; ++id) {
            Payee storage p = _payees[id];
            if (!p.active || p.amount == 0) continue;
            if (_payout(runId, id, p)) ++paid;
            else ++skipped;
        }

        // A late run (missed schedule) restarts the cadence from now instead of firing back-to-back catch-up runs.
        uint256 next = nextRunAt + interval;
        if (next <= block.timestamp) next = block.timestamp + interval;
        nextRunAt = next;
        // The Schedule Service executes a contract's scheduled call with the contract itself as the caller.
        bool byScheduleService = msg.sender == address(this);
        emit RunExecuted(runId, paid, skipped, next, byScheduleService);
        // A run triggered by hand before its schedule fires would leave that schedule to execute too early and revert,
        // so delete it. A schedule that is executing (or whose second has passed) needs nothing but forgetting.
        if (!byScheduleService && block.timestamp < scheduledAt) _cancelSchedule();
        else schedule = address(0);
        _scheduleNextRun();
    }

    /*//////////////////////////////////////////////////////////////
                                TREASURY
    //////////////////////////////////////////////////////////////*/

    /// @param asset the payout token, any other ERC-20, or address(0) for HBAR (amount in tinybars).
    function withdraw(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (asset == address(0)) {
            (bool ok,) = to.call{ value: amount }("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Withdrawn(asset, to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function payeeCount() external view returns (uint256) {
        return _payees.length;
    }

    function getPayee(uint256 id) external view returns (Payee memory) {
        if (id >= _payees.length) revert UnknownPayee(id);
        return _payees[id];
    }

    function getPayees() external view returns (Payee[] memory) {
        return _payees;
    }

    /// @notice What the next run will cost at current CCIP prices.
    /// @return tokens payout tokens the run sends
    /// @return ccipFees CCIP fees in tinybars (0 for Hedera payees)
    /// @return gasLimit the gas limit the run is scheduled with
    function quoteRun() external view returns (uint256 tokens, uint256 ccipFees, uint256 gasLimit) {
        for (uint256 id; id < _payees.length; ++id) {
            Payee storage p = _payees[id];
            if (!p.active || p.amount == 0) continue;
            tokens += p.amount;
            if (p.chainSelector != HEDERA) ccipFees += router.getFee(p.chainSelector, _message(p));
        }
        gasLimit = runGasLimit();
    }

    /// @notice Whether the payout token can be sent to `chainSelector` through CCIP from here.
    function canPayOn(uint64 chainSelector) public view returns (bool) {
        if (!router.isChainSupported(chainSelector)) return false;
        address pool = tokenAdminRegistry.getPool(address(token));
        return pool != address(0) && ITokenPool(pool).isSupportedChain(chainSelector);
    }

    /// @notice Gas limit for a scheduled run with the current active payees.
    function runGasLimit() public view returns (uint256 gasLimit) {
        gasLimit = RUN_BASE_GAS + SCHEDULE_NEXT_GAS;
        for (uint256 id; id < _payees.length; ++id) {
            Payee storage p = _payees[id];
            if (!p.active || p.amount == 0) continue;
            gasLimit += p.chainSelector == HEDERA ? LOCAL_PAYOUT_GAS : CCIP_PAYOUT_GAS;
        }
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @return sent whether the payout went out; failures are reported with `PayoutSkipped`, never reverted.
    function _payout(uint256 runId, uint256 id, Payee storage p) internal returns (bool sent) {
        if (token.balanceOf(address(this)) < p.amount) {
            emit PayoutSkipped(runId, id, SkipReason.InsufficientTokens);
            return false;
        }

        if (p.chainSelector == HEDERA) {
            token.safeTransfer(p.account, p.amount);
            emit PayoutSent(runId, id, p.account, HEDERA, p.amount, bytes32(0), 0);
            return true;
        }

        Client.EVM2AnyMessage memory message = _message(p);
        uint256 fee;
        try router.getFee(p.chainSelector, message) returns (uint256 quoted) {
            fee = quoted;
        } catch {
            emit PayoutSkipped(runId, id, SkipReason.QuoteFailed);
            return false;
        }
        if (address(this).balance < fee) {
            emit PayoutSkipped(runId, id, SkipReason.InsufficientHbar);
            return false;
        }

        token.forceApprove(address(router), p.amount);
        try router.ccipSend{ value: fee }(p.chainSelector, message) returns (bytes32 messageId) {
            emit PayoutSent(runId, id, p.account, p.chainSelector, p.amount, messageId, fee);
            return true;
        } catch {
            token.forceApprove(address(router), 0);
            emit PayoutSkipped(runId, id, SkipReason.SendFailed);
            return false;
        }
    }

    /// @dev A token-only CCIP message to an EOA: no data, so no destination gas, and out-of-order execution allowed
    ///      because payouts do not depend on each other.
    function _message(Payee storage p) internal view returns (Client.EVM2AnyMessage memory message) {
        Client.EVMTokenAmount[] memory amounts = new Client.EVMTokenAmount[](1);
        amounts[0] = Client.EVMTokenAmount({ token: address(token), amount: p.amount });
        message = Client.EVM2AnyMessage({
            receiver: abi.encode(p.account),
            data: "",
            tokenAmounts: amounts,
            feeToken: address(0),
            extraArgs: Client._argsToBytes(Client.GenericExtraArgsV2({ gasLimit: 0, allowOutOfOrderExecution: true }))
        });
    }

    /// @dev Best effort via low-level calls, so a throttled or missing Schedule Service never reverts a run.
    ///      Searches the next few seconds for capacity, because a second can be full of other scheduled calls.
    function _scheduleNextRun() internal {
        uint256 gasLimit = runGasLimit();
        uint256 at = nextRunAt + SCHEDULE_DELAY;
        for (uint256 i; i <= CAPACITY_SEARCH; ++i) {
            if (_hasCapacity(at + i, gasLimit)) {
                at += i;
                (bool ok, bytes memory ret) = address(HSS)
                    .call(
                        abi.encodeCall(
                            IHederaScheduleService.scheduleCall,
                            (address(this), at, gasLimit, 0, abi.encodeCall(this.run, ()))
                        )
                    );
                if (!ok || ret.length < 64) {
                    emit ScheduleFailed(at, -1);
                    return;
                }
                (int64 rc, address created) = abi.decode(ret, (int64, address));
                if (rc != HSS_SUCCESS || created == address(0)) {
                    emit ScheduleFailed(at, rc);
                    return;
                }
                schedule = created;
                scheduledAt = at;
                emit RunScheduled(at, created, gasLimit);
                return;
            }
        }
        emit ScheduleFailed(at, -1);
    }

    function _hasCapacity(uint256 at, uint256 gasLimit) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            address(HSS).staticcall(abi.encodeCall(IHederaScheduleService.hasScheduleCapacity, (at, gasLimit)));
        return ok && ret.length >= 32 && abi.decode(ret, (bool));
    }

    /// @dev Best effort: deleting a schedule that already executed or expired fails harmlessly.
    function _cancelSchedule() internal {
        address pending = schedule;
        if (pending == address(0)) return;
        schedule = address(0);
        (bool ok, bytes memory ret) =
            address(HSS).call(abi.encodeCall(IHederaScheduleService.deleteSchedule, (pending)));
        emit ScheduleCancelled(pending, ok && ret.length >= 32 && abi.decode(ret, (int64)) == HSS_SUCCESS);
    }
}
