// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Lookup of the CCIP token pool registered for a token (TokenAdminRegistry on each CCIP chain).
interface ITokenAdminRegistry {
    function getPool(address token) external view returns (address pool);
}

/// @notice The part of a CCIP token pool that says which destination chains the token can travel to.
interface ITokenPool {
    function isSupportedChain(uint64 remoteChainSelector) external view returns (bool);
}
