// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice 6-decimal EIP-2612 ERC20 mock named "USDC" with an open mint, for tests only.
contract MockPermitUSDC is ERC20Permit {
    constructor() ERC20("USDC", "USDC") ERC20Permit("USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
