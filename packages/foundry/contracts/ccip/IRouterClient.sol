// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Client } from "./Client.sol";

/// @notice The Chainlink CCIP router functions a sender calls (Router 1.2.0 on Hedera testnet).
interface IRouterClient {
    error UnsupportedDestinationChain(uint64 destChainSelector);
    error InsufficientFeeTokenAmount();
    error InvalidMsgValue();

    function isChainSupported(uint64 destChainSelector) external view returns (bool supported);

    /// @return fee in the fee token's smallest unit. For native fees on Hedera that unit is the tinybar.
    function getFee(uint64 destinationChainSelector, Client.EVM2AnyMessage memory message)
        external
        view
        returns (uint256 fee);

    function ccipSend(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message)
        external
        payable
        returns (bytes32 messageId);
}
