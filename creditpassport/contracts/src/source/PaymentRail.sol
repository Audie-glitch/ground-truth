// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PaymentRail
/// @notice Source-chain invoice settlement. Moves the settlement token from payer to payee and
///         emits one `InvoicePaid` log per settlement, which `CreditPassport` on Creditcoin consumes
///         through an Attestcoin inclusion proof.
/// @dev    Deployed on the source chain (Ethereum Sepolia for the testnet build). The log carries
///         the due block so lateness is decided by data that was fixed when the invoice was paid,
///         not by whoever later submits the proof.
contract PaymentRail {
    using SafeERC20 for IERC20;

    IERC20 public immutable TOKEN;

    /// @notice keccak256(payee, invoiceId) => settled. Keyed per payee so invoice ids only need to be
    ///         unique per payee and a stranger cannot pre-empt someone else's id.
    mapping(bytes32 key => bool) public settled;

    event InvoicePaid(
        bytes32 indexed invoiceId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint64 dueBlock,
        uint64 paidBlock
    );

    error ZeroAddress();
    error ZeroAmount();
    error InvoiceAlreadySettled(address payee, bytes32 invoiceId);

    constructor(IERC20 token) {
        if (address(token) == address(0)) revert ZeroAddress();
        TOKEN = token;
    }

    /// @notice Pay `amount` of the settlement token to `payee` for `invoiceId`. `dueBlock` is the
    ///         block by which the payee expected payment; paying after it is recorded as late.
    function payInvoice(bytes32 invoiceId, address payee, uint256 amount, uint64 dueBlock) external {
        if (payee == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        bytes32 key = settlementKey(payee, invoiceId);
        if (settled[key]) revert InvoiceAlreadySettled(payee, invoiceId);
        settled[key] = true;

        TOKEN.safeTransferFrom(msg.sender, payee, amount);
        emit InvoicePaid(invoiceId, msg.sender, payee, amount, dueBlock, uint64(block.number));
    }

    function settlementKey(address payee, bytes32 invoiceId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(payee, invoiceId));
    }
}
