//SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ScaffoldETHDeploy } from "./DeployHelpers.s.sol";
import { CrossChainPayroll } from "../contracts/CrossChainPayroll.sol";
import { IRouterClient } from "../contracts/ccip/IRouterClient.sol";
import { ITokenAdminRegistry } from "../contracts/ccip/ITokenAdminRegistry.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploys CrossChainPayroll wired to Chainlink CCIP on Hedera testnet, paying out CCIP-BnM.
 *         Addresses: https://docs.chain.link/ccip/directory/testnet/chain/hedera-testnet
 * @dev Example: yarn deploy --network hedera_testnet
 *      Overrides: CCIP_ROUTER=0x... TOKEN_ADMIN_REGISTRY=0x... PAYOUT_TOKEN=0x... PAYROLL_INTERVAL=<seconds>.
 *      The payroll starts paused: add payees, fund it, then call `start`.
 */
contract DeployScript is ScaffoldETHDeploy {
    /// Chainlink CCIP Router 1.2.0 on Hedera testnet (https://docs.chain.link/ccip/directory/testnet/chain/hedera-testnet).
    address internal constant TESTNET_CCIP_ROUTER = 0x802C5F84eAD128Ff36fD6a3f8a418e339f467Ce4;
    address internal constant TESTNET_TOKEN_ADMIN_REGISTRY = 0xA6643e4f53ceABad16970e8592D4eF7fea49260a;
    /// CCIP-BnM test token on Hedera testnet (anyone can mint 1 token with `drip(address)`). Its pool reaches Ethereum
    /// Sepolia and OP Sepolia. An older CCIP-BnM (0x01Ac…) is still registered but its Sepolia side rejects it.
    address internal constant TESTNET_CCIP_BNM = 0xF8238FD7Dd2bEbEDaa65c3974175d98e6110bEb1;
    uint256 internal constant DEFAULT_INTERVAL = 7 days;

    function run() external ScaffoldEthDeployerRunner {
        address router = vm.envOr("CCIP_ROUTER", TESTNET_CCIP_ROUTER);
        address payoutToken = vm.envOr("PAYOUT_TOKEN", TESTNET_CCIP_BNM);
        address registry = vm.envOr("TOKEN_ADMIN_REGISTRY", TESTNET_TOKEN_ADMIN_REGISTRY);
        uint256 interval = vm.envOr("PAYROLL_INTERVAL", DEFAULT_INTERVAL);
        CrossChainPayroll payroll = new CrossChainPayroll(
            IRouterClient(router), IERC20(payoutToken), ITokenAdminRegistry(registry), interval
        );
        deployments.push(Deployment({ name: "CrossChainPayroll", addr: address(payroll) }));
    }
}
