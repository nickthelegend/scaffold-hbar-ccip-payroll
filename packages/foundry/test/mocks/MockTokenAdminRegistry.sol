// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ITokenAdminRegistry, ITokenPool } from "../../contracts/ccip/ITokenAdminRegistry.sol";

/// @notice A token pool that supports whichever destination chains the test enables.
contract MockTokenPool is ITokenPool {
    mapping(uint64 => bool) public isSupportedChain;

    function setSupported(uint64 chainSelector, bool supported) external {
        isSupportedChain[chainSelector] = supported;
    }
}

/// @notice Maps tokens to their pools, like CCIP's TokenAdminRegistry.
contract MockTokenAdminRegistry is ITokenAdminRegistry {
    mapping(address => address) public getPool;

    function setPool(address token, address pool) external {
        getPool[token] = pool;
    }
}
