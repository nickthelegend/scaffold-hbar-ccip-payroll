// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Client } from "../../contracts/ccip/Client.sol";
import { IRouterClient } from "../../contracts/ccip/IRouterClient.sol";

/// @notice Behaves like the CCIP router for a sender: checks the lane, charges the fee in msg.value, pulls the tokens
///         (as the token pool would) and returns a message id. Records each message so tests can inspect it.
contract MockCCIPRouter is IRouterClient {
    struct Sent {
        uint64 chainSelector;
        address receiver;
        address token;
        uint256 amount;
        uint256 fee;
        bytes extraArgs;
    }

    mapping(uint64 => uint256) public feeFor;
    mapping(uint64 => bool) public supported;
    bool public failSends;
    bool public failQuotes;
    Sent[] public sent;

    function setLane(uint64 chainSelector, uint256 fee) external {
        supported[chainSelector] = true;
        feeFor[chainSelector] = fee;
    }

    function setFailSends(bool value) external {
        failSends = value;
    }

    function setFailQuotes(bool value) external {
        failQuotes = value;
    }

    function sentCount() external view returns (uint256) {
        return sent.length;
    }

    function isChainSupported(uint64 chainSelector) external view returns (bool) {
        return supported[chainSelector];
    }

    function getFee(uint64 chainSelector, Client.EVM2AnyMessage memory) public view returns (uint256) {
        if (failQuotes || !supported[chainSelector]) revert UnsupportedDestinationChain(chainSelector);
        return feeFor[chainSelector];
    }

    function ccipSend(uint64 chainSelector, Client.EVM2AnyMessage calldata message)
        external
        payable
        returns (bytes32 messageId)
    {
        if (failSends) revert UnsupportedDestinationChain(chainSelector);
        uint256 fee = getFee(chainSelector, message);
        if (msg.value < fee) revert InsufficientFeeTokenAmount();
        Client.EVMTokenAmount calldata ta = message.tokenAmounts[0];
        IERC20(ta.token).transferFrom(msg.sender, address(this), ta.amount);
        sent.push(
            Sent({
                chainSelector: chainSelector,
                receiver: abi.decode(message.receiver, (address)),
                token: ta.token,
                amount: ta.amount,
                fee: msg.value,
                extraArgs: message.extraArgs
            })
        );
        messageId = keccak256(abi.encode(chainSelector, sent.length));
    }
}
