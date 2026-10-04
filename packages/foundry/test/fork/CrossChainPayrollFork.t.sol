// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CrossChainPayroll } from "../../contracts/CrossChainPayroll.sol";
import { IRouterClient } from "../../contracts/ccip/IRouterClient.sol";
import { ITokenAdminRegistry } from "../../contracts/ccip/ITokenAdminRegistry.sol";

/// @notice Runs payroll against the real Chainlink CCIP router and CCIP-BnM on a Hedera testnet fork.
/// @dev yarn foundry:test:testnet --match-path "test/fork/*". Skipped on a plain `forge test` (chain id 31337).
///      A full `ccipSend` cannot run on a fork: the router wraps the HBAR fee through WHBAR, which calls the HTS system
///      contract (0x167) that a plain fork does not have. Live sends are proven on testnet instead (README, Proof).
contract CrossChainPayrollForkTest is Test {
    IRouterClient internal constant ROUTER = IRouterClient(0x802C5F84eAD128Ff36fD6a3f8a418e339f467Ce4);
    IERC20 internal constant CCIP_BNM = IERC20(0xF8238FD7Dd2bEbEDaa65c3974175d98e6110bEb1);
    ITokenAdminRegistry internal constant REGISTRY = ITokenAdminRegistry(0xA6643e4f53ceABad16970e8592D4eF7fea49260a);
    uint64 internal constant ETHEREUM_SEPOLIA = 16_015_286_601_757_825_753;
    uint64 internal constant OP_SEPOLIA = 5_224_473_277_236_331_295;
    uint64 internal constant BASE_SEPOLIA = 10_344_971_235_874_465_080;
    uint256 internal constant HBAR = 1e8;

    CrossChainPayroll internal payroll;
    address internal sepoliaPayee = makeAddr("sepoliaPayee");

    function setUp() public {
        if (block.chainid != 296) vm.skip(true);
        payroll = new CrossChainPayroll(ROUTER, CCIP_BNM, REGISTRY, 1 days);
    }

    /// @notice CCIP-BnM's pool reaches Ethereum Sepolia and OP Sepolia. The router also has a Base Sepolia lane, but the
    ///         token cannot travel it, so the payroll refuses such a payee instead of failing every run.
    function test_realRegistry_onlyAcceptsLanesThePayoutTokenCanTravel() public {
        assertTrue(payroll.canPayOn(ETHEREUM_SEPOLIA));
        assertTrue(payroll.canPayOn(OP_SEPOLIA));
        assertTrue(ROUTER.isChainSupported(BASE_SEPOLIA));
        assertFalse(payroll.canPayOn(BASE_SEPOLIA));

        payroll.addPayee(sepoliaPayee, OP_SEPOLIA, 0.1e18, "op");
        vm.expectRevert(abi.encodeWithSelector(CrossChainPayroll.UnsupportedChain.selector, BASE_SEPOLIA));
        payroll.addPayee(sepoliaPayee, BASE_SEPOLIA, 0.1e18, "base");
        vm.expectRevert(abi.encodeWithSelector(CrossChainPayroll.UnsupportedChain.selector, uint64(1)));
        payroll.addPayee(sepoliaPayee, 1, 0.1e18, "no such chain");
    }

    /// @notice The router prices our exact message in tinybars of native HBAR: the payroll never needs LINK.
    function test_realRouter_quotesTheRunInHbar() public {
        payroll.addPayee(sepoliaPayee, OP_SEPOLIA, 0.1e18, "op");
        payroll.addPayee(sepoliaPayee, ETHEREUM_SEPOLIA, 0.1e18, "sepolia");
        (uint256 tokens, uint256 fee,) = payroll.quoteRun();
        assertEq(tokens, 0.2e18);
        assertGt(fee, 0);
        assertLt(fee, 500 * HBAR, "fee should be tinybars, not weibars");
    }
}
