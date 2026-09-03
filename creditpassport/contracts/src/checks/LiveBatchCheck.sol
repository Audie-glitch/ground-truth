// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {CreditPassport} from "../CreditPassport.sol";
import {TestUSD} from "../TestUSD.sol";

/// @title LiveBatchCheck
/// @notice Batch counterpart of `LivePrecompileCheck`: runs `executeBatch` with a real shared-continuity
///         batch proof against the live verifier inside a constructor, returning the outcome as creation
///         return data. Never deployed; executed through `eth_call`.
contract LiveBatchCheck {
    struct Batch {
        uint8 action;
        uint64 chainKey;
        uint64[] blockHeights;
        bytes[] encodedTransactions;
        INativeQueryVerifier.MerkleProof[] merkleProofs;
        INativeQueryVerifier.ContinuityProof sharedContinuityProof;
    }

    /// @dev abi.encode(Outcome)
    struct Outcome {
        bool recorded;
        bytes reason;
        uint256 processed;
        uint256[] paymentCounts; // per payer, same order as the `payers` argument
        bytes32[] queryIds; // first query id per payer
    }

    constructor(Batch memory batch, address sourceContract, address[] memory payers) {
        TestUSD cUSD = new TestUSD("Credit USD", "cUSD");
        CreditPassport passport = new CreditPassport(batch.chainKey, cUSD, address(this));
        passport.setSources(sourceContract, sourceContract);

        Outcome memory outcome;
        outcome.paymentCounts = new uint256[](payers.length);
        outcome.queryIds = new bytes32[](payers.length);
        try passport.executeBatch(
            batch.action,
            batch.chainKey,
            batch.blockHeights,
            batch.encodedTransactions,
            batch.merkleProofs,
            batch.sharedContinuityProof
        ) returns (uint256 processed) {
            outcome.recorded = true;
            outcome.processed = processed;
            for (uint256 i; i < payers.length; ++i) {
                CreditPassport.Payment[] memory payments = passport.getPayments(payers[i]);
                outcome.paymentCounts[i] = payments.length;
                if (payments.length > 0) outcome.queryIds[i] = payments[0].queryId;
            }
        } catch (bytes memory reason) {
            outcome.reason = reason;
        }

        bytes memory out = abi.encode(outcome);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
