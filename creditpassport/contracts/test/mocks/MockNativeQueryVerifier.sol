// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice Stand-in for the Creditcoin verifier precompile, etched at `0xFD2` in tests.
/// @dev    Stateless so it can be installed with `vm.etch`. Verification fails when the continuity
///         proof's lower endpoint digest equals `FAIL_DIGEST`; the transaction index is read from
///         the sibling `isLeft` flags (bit i set when sibling i is on the left, i.e. our node is right).
contract MockNativeQueryVerifier is INativeQueryVerifier {
    bytes32 public constant FAIL_DIGEST = keccak256("fail");

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool) {
        if (continuityProof.lowerEndpointDigest == FAIL_DIGEST) return false;
        emit TransactionVerified(chainKey, height, _index(merkleProof));
        return true;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata sharedContinuityProof
    ) external returns (bool) {
        if (sharedContinuityProof.lowerEndpointDigest == FAIL_DIGEST) {
            return false;
        }
        for (uint256 i; i < heights.length; ++i) {
            emit TransactionVerified(chainKey, heights[i], _index(merkleProofs[i]));
        }
        return true;
    }

    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata continuityProof)
        external
        pure
        returns (bool)
    {
        return continuityProof.lowerEndpointDigest != FAIL_DIGEST;
    }

    function verify(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        MerkleProof[] calldata,
        ContinuityProof calldata sharedContinuityProof
    ) external pure returns (bool) {
        return sharedContinuityProof.lowerEndpointDigest != FAIL_DIGEST;
    }

    function calculateTxIndex(MerkleProof calldata merkleProof) external pure returns (uint64) {
        return _index(merkleProof);
    }

    function _index(MerkleProof calldata merkleProof) internal pure returns (uint64 index) {
        for (uint256 i; i < merkleProof.siblings.length; ++i) {
            if (merkleProof.siblings[i].isLeft) index |= uint64(1) << uint64(i);
        }
    }
}
