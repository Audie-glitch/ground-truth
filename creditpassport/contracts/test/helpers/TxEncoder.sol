// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice Builds prover-format transaction bytes (`abi.encode(uint8 txType, bytes[] chunks)`) and
///         Merkle proof stubs that the mock verifier maps to a chosen transaction index.
library TxEncoder {
    struct LogEntryTuple {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    struct AccessListEntryBytes32 {
        address account;
        bytes32[] storageKeys;
    }

    bytes32 internal constant INVOICE_PAID_SIG =
        keccak256("InvoicePaid(bytes32,address,address,uint256,uint64,uint64)");
    bytes32 internal constant TRANSFER_SIG = keccak256("Transfer(address,address,uint256)");

    /// @dev EIP-1559 (type 2) transaction with the given receipt status and logs.
    function encodeType2(address from, address to, LogEntryTuple[] memory logs, uint8 status)
        internal
        pure
        returns (bytes memory)
    {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(7), uint64(200_000), from, false, to, uint256(0), bytes(""));
        AccessListEntryBytes32[] memory accessList;
        chunks[1] = abi.encode(
            uint64(11_155_111), uint128(1 gwei), uint128(30 gwei), accessList, uint8(0), bytes32(0), bytes32(0)
        );
        chunks[2] = abi.encode(status, uint64(90_000), logs, new bytes(256));
        return abi.encode(uint8(2), chunks);
    }

    function invoicePaidLog(
        address emitter,
        bytes32 invoiceId,
        address payer,
        address payee,
        uint256 amount,
        uint64 dueBlock,
        uint64 paidBlock
    ) internal pure returns (LogEntryTuple memory log) {
        log.address_ = emitter;
        log.topics = new bytes32[](4);
        log.topics[0] = INVOICE_PAID_SIG;
        log.topics[1] = invoiceId;
        log.topics[2] = bytes32(uint256(uint160(payer)));
        log.topics[3] = bytes32(uint256(uint160(payee)));
        log.data = abi.encode(amount, dueBlock, paidBlock);
    }

    function transferLog(address emitter, address from, address to, uint256 amount)
        internal
        pure
        returns (LogEntryTuple memory log)
    {
        log.address_ = emitter;
        log.topics = new bytes32[](3);
        log.topics[0] = TRANSFER_SIG;
        log.topics[1] = bytes32(uint256(uint160(from)));
        log.topics[2] = bytes32(uint256(uint160(to)));
        log.data = abi.encode(amount);
    }

    function one(LogEntryTuple memory log) internal pure returns (LogEntryTuple[] memory logs) {
        logs = new LogEntryTuple[](1);
        logs[0] = log;
    }

    function two(LogEntryTuple memory a, LogEntryTuple memory b) internal pure returns (LogEntryTuple[] memory logs) {
        logs = new LogEntryTuple[](2);
        logs[0] = a;
        logs[1] = b;
    }

    /// @dev Sibling flags encode `txIndex` for the mock verifier; three levels allow indices 0..7.
    function siblingsFor(uint64 txIndex) internal pure returns (INativeQueryVerifier.MerkleProofEntry[] memory s) {
        s = new INativeQueryVerifier.MerkleProofEntry[](3);
        for (uint256 i; i < 3; ++i) {
            s[i] = INativeQueryVerifier.MerkleProofEntry({
                hash: keccak256(abi.encodePacked("sibling", txIndex, i)), isLeft: (txIndex >> i) & 1 == 1
            });
        }
    }

    function merkleProofFor(uint64 txIndex) internal pure returns (INativeQueryVerifier.MerkleProof memory) {
        return INativeQueryVerifier.MerkleProof({
            root: keccak256(abi.encodePacked("root", txIndex)), siblings: siblingsFor(txIndex)
        });
    }

    function continuity(bytes32 lowerEndpointDigest)
        internal
        pure
        returns (INativeQueryVerifier.ContinuityProof memory c)
    {
        c.lowerEndpointDigest = lowerEndpointDigest;
        c.roots = new bytes32[](2);
        c.roots[0] = keccak256("r0");
        c.roots[1] = keccak256("r1");
    }
}
