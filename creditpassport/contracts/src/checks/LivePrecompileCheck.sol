// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {CreditPassport} from "../CreditPassport.sol";
import {TestUSD} from "../TestUSD.sol";

/// @title LivePrecompileCheck
/// @notice Never deployed. Its constructor deploys a fresh CreditPassport, registers `sourceContract` as
///         both rail and settlement token, submits one real proof through `execute`, and then returns the
///         ABI-encoded outcome as its "runtime code". Executed through `eth_call` (no `to`, creation
///         bytecode as data) against a live Creditcoin RPC, the call returns that outcome directly, so the
///         contract is exercised against the real verifier precompile without deploying anything or
///         spending gas. Some RPCs drop revert data from constructors, hence returning instead of reverting.
///         See `agent/src/cli.ts livecheck`.
contract LivePrecompileCheck {
    struct Proof {
        uint8 action;
        uint64 chainKey;
        uint64 blockHeight;
        bytes encodedTransaction;
        bytes32 merkleRoot;
        INativeQueryVerifier.MerkleProofEntry[] siblings;
        bytes32 lowerEndpointDigest;
        bytes32[] continuityRoots;
    }

    /// @dev Layout of the returned bytes: abi.encode(Outcome).
    struct Outcome {
        bool recorded;
        bytes reason; // passport revert data when not recorded
        address payer;
        address payee;
        uint256 amount;
        uint256 paymentCount;
        bytes32 queryId;
    }

    constructor(Proof memory proof, address sourceContract, address payer) {
        TestUSD cUSD = new TestUSD("Credit USD", "cUSD");
        CreditPassport passport = new CreditPassport(proof.chainKey, cUSD, address(this));
        passport.setSources(sourceContract, sourceContract);

        Outcome memory outcome;
        outcome.payer = payer;
        try passport.execute(
            proof.action,
            proof.chainKey,
            proof.blockHeight,
            proof.encodedTransaction,
            proof.merkleRoot,
            proof.siblings,
            proof.lowerEndpointDigest,
            proof.continuityRoots
        ) {
            CreditPassport.Payment[] memory payments = passport.getPayments(payer);
            outcome.recorded = true;
            outcome.paymentCount = payments.length;
            if (payments.length > 0) {
                outcome.payee = payments[0].payee;
                outcome.amount = payments[0].amount;
                outcome.queryId = payments[0].queryId;
            }
        } catch (bytes memory reason) {
            outcome.reason = reason;
        }

        bytes memory out = abi.encode(outcome);
        // Returned as the created contract's code; the first byte is 0x00 so EIP-3541 does not apply.
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
