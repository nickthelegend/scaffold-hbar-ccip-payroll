// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The subset of Chainlink CCIP's `Client` library that a sender needs.
/// @dev Field layout matches `@chainlink/contracts-ccip` (src/v0.8/ccip/libraries/Client.sol) so messages encode
///      identically; vendored to keep the template free of an extra git submodule.
library Client {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }

    struct EVM2AnyMessage {
        bytes receiver; // abi.encode(receiver address) for EVM destinations
        bytes data; // empty for a plain token transfer
        EVMTokenAmount[] tokenAmounts;
        address feeToken; // address(0) pays the fee in the native gas token (HBAR on Hedera)
        bytes extraArgs;
    }

    /// @dev bytes4(keccak256("CCIP EVMExtraArgsV2"))
    bytes4 internal constant GENERIC_EXTRA_ARGS_V2_TAG = 0x181dcf10;

    struct GenericExtraArgsV2 {
        uint256 gasLimit; // gas for the receiver's ccipReceive; 0 when the receiver is an EOA
        bool allowOutOfOrderExecution;
    }

    function _argsToBytes(GenericExtraArgsV2 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(GENERIC_EXTRA_ARGS_V2_TAG, extraArgs);
    }
}
