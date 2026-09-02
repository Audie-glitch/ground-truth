// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @title AttestedBase
/// @notice Base for Application Smart Contracts that act on transactions proven to have happened
///         on another chain, verified through Creditcoin's Native Query Verifier precompile.
/// @dev    Modeled on `ASCBase` from `@gluwa/asc-contracts`. It keeps ASCBase's query-id derivation
///         (chainKey, blockHeight, txIndex) so replay protection is identical, and adds what a
///         credit application needs on top:
///
///         1. Source-chain binding. `ASCBase.execute` accepts any chainKey the verifier knows. A
///            payment contract deployed at the same address on two source chains would otherwise be
///            interchangeable, so every proof here must carry the chainKey fixed at construction.
///         2. A batch path over the verifier's batch overload, so a payer can import up to
///            `MAX_BATCH` proven transactions that share one continuity proof in a single call.
///         3. The proven block height is passed to the application hook, because some source
///            events do not carry their own block number.
abstract contract AttestedBase {
    /// @notice Native Query Verifier precompile (`0xFD2`).
    INativeQueryVerifier public immutable VERIFIER;

    /// @notice Creditcoin-internal key of the only source chain this contract accepts proofs from.
    uint64 public immutable SOURCE_CHAIN_KEY;

    /// @notice Upper bound on proofs per `executeBatch`; matches the hosted prover's batch limit.
    uint256 public constant MAX_BATCH = 10;

    mapping(bytes32 queryId => bool) public processedQueries;

    error WrongSourceChain(uint64 provided, uint64 expected);
    error QueryAlreadyProcessed(bytes32 queryId);
    error ProofVerificationFailed();
    error EmptyBatch();
    error BatchTooLarge(uint256 size);
    error BatchLengthMismatch();
    error NothingNewInBatch();

    event QueryProcessed(bytes32 indexed queryId, uint64 indexed blockHeight, uint8 action);

    constructor(uint64 sourceChainKey) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        SOURCE_CHAIN_KEY = sourceChainKey;
    }

    /// @notice Application hook, invoked once per proven transaction after verification and dedup.
    /// @param action Caller-supplied discriminator telling the application what to look for.
    /// @param queryId Stable id of the proven transaction (chainKey, blockHeight, txIndex).
    /// @param blockHeight Source-chain block that included the transaction.
    /// @param txIndex Position of the transaction in that block, as computed by the verifier.
    /// @param encodedTransaction Prover-encoded transaction and receipt bytes.
    function _processAndEmitEvent(
        uint8 action,
        bytes32 queryId,
        uint64 blockHeight,
        uint64 txIndex,
        bytes memory encodedTransaction
    ) internal virtual;

    /// @notice Verify one transaction's inclusion and continuity, then hand it to the application.
    function execute(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        _requireSourceChain(chainKey);

        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        (bytes32 queryId, uint64 txIndex) = _computeQueryId(chainKey, blockHeight, merkleProof);
        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);

        bool verified = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        if (!verified) revert ProofVerificationFailed();

        processedQueries[queryId] = true;
        _processAndEmitEvent(action, queryId, blockHeight, txIndex, encodedTransaction);
        emit QueryProcessed(queryId, blockHeight, action);
        return true;
    }

    /// @notice Verify up to `MAX_BATCH` transactions that share one continuity proof, then hand each
    ///         not-yet-processed transaction to the application.
    /// @dev    Already-processed entries are skipped rather than reverting, so two submitters racing
    ///         on overlapping batches both succeed and the ledger ends up identical. Reverts only if
    ///         the whole batch is stale.
    /// @return processed Number of transactions handed to the application in this call.
    function executeBatch(
        uint8 action,
        uint64 chainKey,
        uint64[] calldata blockHeights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external returns (uint256 processed) {
        _requireSourceChain(chainKey);

        uint256 n = blockHeights.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge(n);
        if (encodedTransactions.length != n || merkleProofs.length != n) revert BatchLengthMismatch();

        bytes32[] memory queryIds = new bytes32[](n);
        uint64[] memory txIndexes = new uint64[](n);
        bool[] memory isNew = new bool[](n);
        for (uint256 i; i < n; ++i) {
            (queryIds[i], txIndexes[i]) = _computeQueryId(chainKey, blockHeights[i], merkleProofs[i]);
            // A batch may legitimately contain the same transaction twice only through caller error;
            // treat the second occurrence as already processed.
            isNew[i] = !processedQueries[queryIds[i]];
            for (uint256 j; j < i && isNew[i]; ++j) {
                if (queryIds[j] == queryIds[i]) isNew[i] = false;
            }
            if (isNew[i]) ++processed;
        }
        if (processed == 0) revert NothingNewInBatch();

        bool verified =
            VERIFIER.verifyAndEmit(chainKey, blockHeights, encodedTransactions, merkleProofs, sharedContinuityProof);
        if (!verified) revert ProofVerificationFailed();

        for (uint256 i; i < n; ++i) {
            if (!isNew[i]) continue;
            processedQueries[queryIds[i]] = true;
            _processAndEmitEvent(action, queryIds[i], blockHeights[i], txIndexes[i], encodedTransactions[i]);
            emit QueryProcessed(queryIds[i], blockHeights[i], action);
        }
    }

    function _requireSourceChain(uint64 chainKey) internal view {
        if (chainKey != SOURCE_CHAIN_KEY) revert WrongSourceChain(chainKey, SOURCE_CHAIN_KEY);
    }

    /// @dev Byte-identical to ASCBase's derivation: keccak256(uint256 chainKey ‖ uint64 blockHeight ‖ uint256 txIndex).
    function _computeQueryId(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProof memory merkleProof)
        internal
        view
        returns (bytes32 queryId, uint64 txIndex)
    {
        txIndex = VERIFIER.calculateTxIndex(merkleProof);
        queryId = keccak256(abi.encodePacked(uint256(chainKey), blockHeight, uint256(txIndex)));
    }
}
