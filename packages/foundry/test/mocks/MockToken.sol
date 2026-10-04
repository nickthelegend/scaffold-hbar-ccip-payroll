// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for CCIP-BnM: an 18-decimal ERC-20 anyone can mint. `refuse` makes transfers to an address revert,
///         like an HTS token sent to an account that is not associated with it.
contract MockToken is ERC20 {
    mapping(address => bool) public refused;

    constructor() ERC20("CCIP-BnM", "CCIP-BnM") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function refuse(address account) external {
        refused[account] = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!refused[to], "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT");
        super._update(from, to, value);
    }
}
