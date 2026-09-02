// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSD
/// @notice Six-decimal test stablecoin with an open mint, for testnets only. Deployed once on the
///         source chain as the settlement token and once on Creditcoin as the credit-line token.
contract TestUSD is ERC20 {
    uint256 public constant MAX_MINT_PER_CALL = 1_000_000 * 1e6;

    error MintTooLarge(uint256 amount);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT_PER_CALL) revert MintTooLarge(amount);
        _mint(to, amount);
    }
}
