// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test, Vm } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CrossChainPayroll } from "../contracts/CrossChainPayroll.sol";
import { Client } from "../contracts/ccip/Client.sol";
import { IRouterClient } from "../contracts/ccip/IRouterClient.sol";
import { MockCCIPRouter } from "./mocks/MockCCIPRouter.sol";
import { MockToken } from "./mocks/MockToken.sol";
import { MockTokenAdminRegistry, MockTokenPool } from "./mocks/MockTokenAdminRegistry.sol";
import { ITokenAdminRegistry } from "../contracts/ccip/ITokenAdminRegistry.sol";
import { MockHederaScheduleService } from "./mocks/MockHederaScheduleService.sol";

contract CrossChainPayrollTest is Test {
    address internal constant HSS_ADDRESS = address(0x16b);
    uint64 internal constant SEPOLIA = 16_015_286_601_757_825_753;
    uint64 internal constant HEDERA = 0;
    uint256 internal constant HBAR = 1e8; // tinybars
    uint256 internal constant TOKEN = 1e18;
    uint256 internal constant FEE = 34 * HBAR; // what Hedera testnet -> Sepolia costs today
    uint256 internal constant WEEK = 7 days;

    MockCCIPRouter internal router;
    MockToken internal token;
    MockHederaScheduleService internal hss;
    MockTokenAdminRegistry internal registry;
    MockTokenPool internal pool;
    CrossChainPayroll internal payroll;

    address internal alice = makeAddr("alice"); // paid on Sepolia
    address internal bob = makeAddr("bob"); // paid on Hedera
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_790_000_000);
        router = new MockCCIPRouter();
        router.setLane(SEPOLIA, FEE);
        token = new MockToken();
        pool = new MockTokenPool();
        pool.setSupported(SEPOLIA, true);
        registry = new MockTokenAdminRegistry();
        registry.setPool(address(token), address(pool));
        vm.etch(HSS_ADDRESS, address(new MockHederaScheduleService()).code);
        hss = MockHederaScheduleService(HSS_ADDRESS);

        payroll = new CrossChainPayroll(
            IRouterClient(address(router)), IERC20(address(token)), ITokenAdminRegistry(address(registry)), WEEK
        );
        payroll.addPayee(alice, SEPOLIA, 2 * TOKEN, "Alice (design)");
        payroll.addPayee(bob, HEDERA, 1 * TOKEN, "Bob (ops)");
        token.mint(address(payroll), 10 * TOKEN);
        vm.deal(address(payroll), 100 * HBAR);
    }

    function _start() internal returns (uint256 firstRunAt) {
        firstRunAt = block.timestamp + 1 hours;
        payroll.start(firstRunAt);
    }

    /*//////////////////////////////////////////////////////////////
                                 SETUP
    //////////////////////////////////////////////////////////////*/

    function test_constructor_startsPausedWithConfig() public view {
        assertTrue(payroll.paused());
        assertEq(address(payroll.router()), address(router));
        assertEq(address(payroll.token()), address(token));
        assertEq(payroll.interval(), WEEK);
        assertEq(payroll.payeeCount(), 2);
    }

    function test_constructor_rejectsShortInterval() public {
        vm.expectRevert(CrossChainPayroll.IntervalTooShort.selector);
        new CrossChainPayroll(
            IRouterClient(address(router)), IERC20(address(token)), ITokenAdminRegistry(address(registry)), 59
        );
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(CrossChainPayroll.ZeroAddress.selector);
        new CrossChainPayroll(
            IRouterClient(address(0)), IERC20(address(token)), ITokenAdminRegistry(address(registry)), WEEK
        );
    }

    function test_addPayee_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        payroll.addPayee(stranger, HEDERA, TOKEN, "me");
    }

    function test_addPayee_rejectsLaneTheRouterDoesNotSupport() public {
        vm.expectRevert(abi.encodeWithSelector(CrossChainPayroll.UnsupportedChain.selector, uint64(42)));
        payroll.addPayee(alice, 42, TOKEN, "nowhere");
    }

    /// @dev The router can know a lane the payout token's pool does not: every payout there would fail on-chain.
    function test_addPayee_rejectsLaneThePayoutTokenCannotTravel() public {
        uint64 base = 10_344_971_235_874_465_080;
        router.setLane(base, FEE);
        assertFalse(payroll.canPayOn(base));
        vm.expectRevert(abi.encodeWithSelector(CrossChainPayroll.UnsupportedChain.selector, base));
        payroll.addPayee(alice, base, TOKEN, "base");

        pool.setSupported(base, true);
        assertTrue(payroll.canPayOn(base));
        payroll.addPayee(alice, base, TOKEN, "base");
    }

    function test_addPayee_rejectsZeroAccount() public {
        vm.expectRevert(CrossChainPayroll.ZeroAddress.selector);
        payroll.addPayee(address(0), HEDERA, TOKEN, "nobody");
    }

    function test_addPayee_capsTheList() public {
        uint256 room = payroll.MAX_PAYEES() - payroll.payeeCount();
        for (uint256 i; i < room; ++i) {
            payroll.addPayee(address(uint160(1000 + i)), HEDERA, TOKEN, "");
        }
        vm.expectRevert(CrossChainPayroll.TooManyPayees.selector);
        payroll.addPayee(stranger, HEDERA, TOKEN, "one too many");
    }

    function test_getPayee_returnsWhatWasAdded() public view {
        CrossChainPayroll.Payee memory p = payroll.getPayee(0);
        assertEq(p.account, alice);
        assertEq(p.chainSelector, SEPOLIA);
        assertEq(p.amount, 2 * TOKEN);
        assertTrue(p.active);
        assertEq(p.label, "Alice (design)");
    }

    /*//////////////////////////////////////////////////////////////
                                SCHEDULE
    //////////////////////////////////////////////////////////////*/

    function test_start_schedulesTheFirstRunWithTheHederaScheduleService() public {
        uint256 firstRunAt = _start();

        assertFalse(payroll.paused());
        assertEq(payroll.nextRunAt(), firstRunAt);
        assertEq(hss.count(), 1);
        (address to, uint256 expiry, uint256 gasLimit, bytes memory callData) = hss.scheduled(0);
        assertEq(to, address(payroll));
        assertEq(expiry, firstRunAt + payroll.SCHEDULE_DELAY());
        assertEq(
            gasLimit,
            payroll.RUN_BASE_GAS() + payroll.SCHEDULE_NEXT_GAS() + payroll.CCIP_PAYOUT_GAS()
                + payroll.LOCAL_PAYOUT_GAS()
        );
        assertEq(callData, abi.encodeCall(CrossChainPayroll.run, ()));
        assertTrue(payroll.schedule() != address(0));
    }

    function test_start_inThePastRunsFromNow() public {
        payroll.start(1);
        assertEq(payroll.nextRunAt(), block.timestamp);
    }

    function test_run_revertsWhilePausedOrBeforeItIsDue() public {
        vm.expectRevert(CrossChainPayroll.IsPaused.selector);
        payroll.run();

        uint256 firstRunAt = _start();
        vm.expectRevert(abi.encodeWithSelector(CrossChainPayroll.NotDue.selector, firstRunAt));
        payroll.run();
    }

    function test_scheduledRun_paysEveryoneAndSchedulesTheNextOne() public {
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt + payroll.SCHEDULE_DELAY());

        (bool ok,) = hss.fire(0);
        assertTrue(ok, "scheduled run reverted");

        // Alice: CCIP to Sepolia, fee paid in HBAR, tokens pulled by the router.
        assertEq(router.sentCount(), 1);
        (uint64 chain, address receiver, address sentToken, uint256 amount, uint256 fee, bytes memory extraArgs) =
            router.sent(0);
        assertEq(chain, SEPOLIA);
        assertEq(receiver, alice);
        assertEq(sentToken, address(token));
        assertEq(amount, 2 * TOKEN);
        assertEq(fee, FEE);
        assertEq(
            extraArgs, Client._argsToBytes(Client.GenericExtraArgsV2({ gasLimit: 0, allowOutOfOrderExecution: true }))
        );
        // Bob: paid on Hedera directly.
        assertEq(token.balanceOf(bob), 1 * TOKEN);
        assertEq(token.balanceOf(address(payroll)), 7 * TOKEN);
        assertEq(address(payroll).balance, 100 * HBAR - FEE);

        assertEq(payroll.runCount(), 1);
        assertEq(payroll.nextRunAt(), firstRunAt + WEEK);
        assertEq(hss.count(), 2);
        (, uint256 nextExpiry,,) = hss.scheduled(1);
        assertEq(nextExpiry, firstRunAt + WEEK + payroll.SCHEDULE_DELAY());
    }

    function test_run_emitsAPayoutPerPayee() public {
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt);

        vm.recordLogs();
        payroll.run();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 sentTopic = CrossChainPayroll.PayoutSent.selector;
        uint256 sentEvents;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(payroll) && logs[i].topics[0] == sentTopic) ++sentEvents;
        }
        assertEq(sentEvents, 2);
    }

    function test_run_isPermissionlessOnceDue() public {
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt);
        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.RunExecuted(1, 2, 0, firstRunAt + WEEK, false);
        vm.prank(stranger);
        payroll.run();
        assertEq(payroll.runCount(), 1);
    }

    function test_manualRun_deletesThePendingScheduleBeforeSchedulingTheNext() public {
        uint256 firstRunAt = _start();
        address pending = payroll.schedule();
        vm.warp(firstRunAt);

        payroll.run();

        assertTrue(hss.deleted(pending), "early schedule left to fire and revert");
        assertEq(hss.count(), 2);
        assertTrue(payroll.schedule() != pending);
    }

    /// @dev The network runs a scheduled call with the scheduling contract as the caller, and `block.timestamp` can
    ///      read the start of the block, i.e. before `scheduledAt`. Such a run must not try to delete its own schedule.
    function test_scheduledRun_doesNotSpendGasDeletingItsOwnSchedule() public {
        uint256 firstRunAt = _start();
        address pending = payroll.schedule();
        vm.warp(payroll.scheduledAt() - 2);

        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.RunExecuted(1, 2, 0, firstRunAt + WEEK, true);
        vm.prank(address(payroll));
        payroll.run();

        assertFalse(hss.deleted(pending));
        assertEq(payroll.scheduledAt(), firstRunAt + WEEK + payroll.SCHEDULE_DELAY());
    }

    function test_lateRun_restartsTheCadenceFromNow() public {
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt + 3 * WEEK);
        payroll.run();
        assertEq(payroll.nextRunAt(), block.timestamp + WEEK);
    }

    function test_pause_deletesTheScheduleAndStopsRuns() public {
        uint256 firstRunAt = _start();
        address pending = payroll.schedule();

        payroll.pause();

        assertTrue(payroll.paused());
        assertTrue(hss.deleted(pending));
        assertEq(payroll.schedule(), address(0));
        vm.warp(firstRunAt);
        vm.expectRevert(CrossChainPayroll.IsPaused.selector);
        payroll.run();
    }

    function test_noScheduleCapacity_isReportedAndRunStaysPermissionless() public {
        hss.setNoCapacity(true);
        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.ScheduleFailed(block.timestamp + 1 hours + payroll.SCHEDULE_DELAY(), -1);
        uint256 firstRunAt = _start();

        assertEq(payroll.schedule(), address(0));
        vm.warp(firstRunAt);
        vm.prank(stranger);
        payroll.run();
        assertEq(payroll.runCount(), 1);
    }

    function test_scheduleServiceError_isReportedNotReverted() public {
        hss.setFailureCode(7); // INVALID_SIGNATURE, as an example
        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.ScheduleFailed(block.timestamp + 1 hours + payroll.SCHEDULE_DELAY(), 7);
        _start();
        assertEq(payroll.schedule(), address(0));
    }

    /*//////////////////////////////////////////////////////////////
                         PAYOUTS THAT CANNOT GO OUT
    //////////////////////////////////////////////////////////////*/

    function test_notEnoughTokens_skipsThatPayeeOnly() public {
        payroll.withdraw(address(token), address(this), 9 * TOKEN); // 1 left: enough for Bob, not Alice
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt);

        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.PayoutSkipped(1, 0, CrossChainPayroll.SkipReason.InsufficientTokens);
        payroll.run();

        assertEq(router.sentCount(), 0);
        assertEq(token.balanceOf(bob), TOKEN);
    }

    function test_notEnoughHbarForTheCcipFee_skipsCrossChainPayeesOnly() public {
        payroll.withdraw(address(0), address(this), 100 * HBAR - FEE + 1);
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt);

        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.PayoutSkipped(1, 0, CrossChainPayroll.SkipReason.InsufficientHbar);
        payroll.run();

        assertEq(router.sentCount(), 0);
        assertEq(token.balanceOf(bob), TOKEN);
    }

    function test_hederaPayoutRefusedByTheToken_isSkippedNotReverted() public {
        token.refuse(bob);
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt);

        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.PayoutSkipped(1, 1, CrossChainPayroll.SkipReason.TransferFailed);
        payroll.run();

        assertEq(router.sentCount(), 1, "Alice still paid");
        assertEq(payroll.nextRunAt(), firstRunAt + WEEK);
    }

    function test_quoteFailure_isSkipped() public {
        uint256 firstRunAt = _start();
        router.setFailQuotes(true);
        vm.warp(firstRunAt);

        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.PayoutSkipped(1, 0, CrossChainPayroll.SkipReason.QuoteFailed);
        payroll.run();
        assertEq(token.balanceOf(bob), TOKEN);
    }

    function test_sendFailure_isSkippedAndTheApprovalCleared() public {
        uint256 firstRunAt = _start();
        router.setFailSends(true);
        vm.warp(firstRunAt);

        vm.expectEmit(address(payroll));
        emit CrossChainPayroll.PayoutSkipped(1, 0, CrossChainPayroll.SkipReason.SendFailed);
        payroll.run();

        assertEq(token.allowance(address(payroll), address(router)), 0);
        assertEq(address(payroll).balance, 100 * HBAR, "fee kept when the send fails");
        assertEq(token.balanceOf(bob), TOKEN);
        assertEq(payroll.nextRunAt(), firstRunAt + WEEK, "a failed payout does not stop payroll");
    }

    /*//////////////////////////////////////////////////////////////
                            OWNER MANAGEMENT
    //////////////////////////////////////////////////////////////*/

    function test_updatePayee_inactiveIsNotPaidAndNotBudgeted() public {
        uint256 before = payroll.runGasLimit();
        payroll.updatePayee(0, 2 * TOKEN, false);
        assertEq(payroll.runGasLimit(), before - payroll.CCIP_PAYOUT_GAS());

        uint256 firstRunAt = _start();
        vm.warp(firstRunAt);
        payroll.run();
        assertEq(router.sentCount(), 0);
        assertEq(token.balanceOf(bob), TOKEN);
    }

    function test_updatePayee_unknownIdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CrossChainPayroll.UnknownPayee.selector, 9));
        payroll.updatePayee(9, TOKEN, true);
    }

    function test_setInterval_appliesFromTheNextRun() public {
        uint256 firstRunAt = _start();
        payroll.setInterval(1 days);
        vm.warp(firstRunAt);
        payroll.run();
        assertEq(payroll.nextRunAt(), firstRunAt + 1 days);
    }

    function test_withdraw_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        payroll.withdraw(address(0), stranger, 1);
    }

    function test_withdraw_hbarAndTokens() public {
        address treasurer = makeAddr("treasurer");
        payroll.withdraw(address(0), treasurer, 10 * HBAR);
        payroll.withdraw(address(token), treasurer, 3 * TOKEN);
        assertEq(treasurer.balance, 10 * HBAR);
        assertEq(token.balanceOf(treasurer), 3 * TOKEN);
    }

    function test_quoteRun_sumsTokensAndCrossChainFees() public view {
        (uint256 tokens, uint256 fees, uint256 gasLimit, uint256 unquoted) = payroll.quoteRun();
        assertEq(tokens, 3 * TOKEN);
        assertEq(fees, FEE);
        assertEq(gasLimit, payroll.runGasLimit());
        assertEq(unquoted, 0);
    }

    function test_quoteRun_reportsLanesThatCannotBeQuotedInsteadOfReverting() public {
        router.setFailQuotes(true);
        (uint256 tokens, uint256 fees,, uint256 unquoted) = payroll.quoteRun();
        assertEq(tokens, 3 * TOKEN);
        assertEq(fees, 0);
        assertEq(unquoted, 1);
    }

    /// @dev A pending schedule keeps the gas limit it was created with, so a bigger payroll must reschedule or the
    ///      next run would run out of gas inside the Schedule Service.
    function test_addingAPayeeWhileRunning_reschedulesWithTheNewBudget() public {
        _start();
        address pending = payroll.schedule();
        uint256 before = payroll.scheduledGasLimit();

        payroll.addPayee(stranger, SEPOLIA, TOKEN, "new hire");

        assertTrue(hss.deleted(pending));
        assertEq(payroll.scheduledGasLimit(), before + payroll.CCIP_PAYOUT_GAS());
        (,, uint256 gasLimit,) = hss.scheduled(hss.count() - 1);
        assertEq(gasLimit, payroll.runGasLimit());
    }

    function test_reactivatingAPayee_reschedules_butChangingAnAmountDoesNot() public {
        payroll.updatePayee(0, 2 * TOKEN, false);
        _start();
        address pending = payroll.schedule();

        payroll.updatePayee(1, 5 * TOKEN, true);
        assertEq(payroll.schedule(), pending, "same budget, same schedule");

        payroll.updatePayee(0, 2 * TOKEN, true);
        assertTrue(hss.deleted(pending));
        assertEq(payroll.scheduledGasLimit(), payroll.runGasLimit());
    }

    function test_payeeChangesWhilePaused_doNotSchedule() public {
        payroll.addPayee(stranger, SEPOLIA, TOKEN, "new hire");
        assertEq(hss.count(), 0);
    }

    /// @notice Whatever the amounts, a funded run pays exactly the active payees' amounts and nothing else.
    function testFuzz_fundedRunPaysExactlyTheActiveAmounts(uint96 a, uint96 b, bool aliceActive) public {
        payroll.updatePayee(0, a, aliceActive);
        payroll.updatePayee(1, b, true);
        token.mint(address(payroll), uint256(a) + b);
        uint256 treasuryBefore = token.balanceOf(address(payroll));
        uint256 firstRunAt = _start();
        vm.warp(firstRunAt);

        payroll.run();

        uint256 expected = (aliceActive ? uint256(a) : 0) + b;
        assertEq(treasuryBefore - token.balanceOf(address(payroll)), expected);
        assertEq(token.balanceOf(bob), b);
        assertEq(token.balanceOf(address(router)), aliceActive ? a : 0);
    }

    receive() external payable { }
}
