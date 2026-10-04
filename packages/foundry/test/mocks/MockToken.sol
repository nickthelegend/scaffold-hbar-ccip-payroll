// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for CCIP-BnM: an 18-decimal ERC-20 anyone can mint.
contract MockToken is ERC20 {
    constructor() ERC20("CCIP-BnM", "CCIP-BnM") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
