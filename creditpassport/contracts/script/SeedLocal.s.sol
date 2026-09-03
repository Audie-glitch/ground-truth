// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {CreditPassport} from "../src/CreditPassport.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {TxEncoder} from "../test/helpers/TxEncoder.sol";

/// @notice Local demo seed. Expects an anvil node with `MockNativeQueryVerifier` bytecode installed at
///         the verifier precompile address (see ../../scripts/demo-local.sh). Deploys the Creditcoin side,
///         imports fabricated but correctly encoded proofs for two demo payers, underwrites one of them,
///         and has that payer draw against the line, so the web app has a full story to render without
///         testnet funds.
///
///   forge script script/SeedLocal.s.sol --rpc-url http://127.0.0.1:48545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract SeedLocal is Script {
    address internal constant RAIL = address(uint160(0xBA11));
    address internal constant SETTLEMENT_TOKEN = address(uint160(0x7057));
    address internal constant MERCHANT = address(uint160(0xCAFE));

    // Second anvil account: the demo payer that draws credit.
    address internal constant ALICE = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 internal constant ALICE_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    // Third anvil account: a payer with a spotty record.
    address internal constant BOB = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    uint64 internal constant CHAIN_KEY = 1;
    uint64 internal nextIndex;

    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        TestUSD cUSD = new TestUSD("Credit USD", "cUSD");
        CreditPassport passport = new CreditPassport(CHAIN_KEY, cUSD, deployer);
        cUSD.mint(address(passport), 1_000_000e6);
        passport.setSources(RAIL, SETTLEMENT_TOKEN);
        passport.setAgent(deployer);

        // Alice: five on-time invoices to a merchant over ~3 days of Sepolia blocks, then one late.
        uint64 base = 11_600_000;
        _invoice(passport, ALICE, "ALICE-0001", 250e6, base + 100, base + 40);
        _invoice(passport, ALICE, "ALICE-0002", 480e6, base + 7_300, base + 7_250);
        _invoice(passport, ALICE, "ALICE-0003", 120e6, base + 14_500, base + 14_400);
        _batch(passport, ALICE, base + 21_000);
        _invoice(passport, ALICE, "ALICE-0006", 90e6, base + 21_900, base + 22_050);

        // Bob: one on-time, two late.
        _invoice(passport, BOB, "BOB-0001", 60e6, base + 500, base + 450);
        _invoice(passport, BOB, "BOB-0002", 75e6, base + 8_000, base + 8_400);
        _invoice(passport, BOB, "BOB-0003", 40e6, base + 15_000, base + 15_900);

        // Underwrite Alice within policy, then she draws.
        uint256 aliceMax = passport.maxCreditLimit(ALICE);
        passport.underwrite(
            ALICE,
            812,
            aliceMax,
            "data:application/json;base64,eyJ2IjoxLCJnZW5lcmF0ZWRBdCI6IjIwMjYtMDktMDJUMDA6MDA6MDAuMDAwWiIsInBheWVyIjoiMHg3MDk5Nzk3MEM1MTgxMmRjM0EwMTBDN2QwMWI1MGUwZDE3ZGM3OUM4Iiwic2NvcmUiOjgxMiwiY3JlZGl0TGltaXQiOiI2MDYyNTAwMDAiLCJwb2xpY3lNYXgiOiI2MDYyNTAwMDAiLCJwYXltZW50Q291bnQiOjYsImZhY3RvcnMiOltdLCJoaXN0b3J5Ijp7fSwibmFycmF0aXZlIjoiTG9jYWwgZGVtbyBtZW1vOiBsaW1pdCBzZXQgdG8gdGhlIHBvbGljeSBjYXAgZnJvbSBzaXggcHJvdmVuIGludm9pY2VzLCBmaXZlIG9uIHRpbWUuIiwibmFycmF0aXZlU291cmNlIjoic2VlZCJ9"
        );
        vm.stopBroadcast();

        vm.startBroadcast(ALICE_KEY);
        passport.draw(aliceMax / 3);
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("TestUSD (cUSD)   ", address(cUSD));
        console.log("CreditPassport   ", address(passport));
        console.log("agent/owner      ", deployer);
        console.log("alice            ", ALICE);
        console.log("bob              ", BOB);

        string memory json = "local";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "sourceChainKey", CHAIN_KEY);
        vm.serializeAddress(json, "creditToken", address(cUSD));
        vm.serializeAddress(json, "agent", deployer);
        vm.serializeAddress(json, "paymentRail", RAIL);
        vm.serializeAddress(json, "railToken", SETTLEMENT_TOKEN);
        vm.serializeAddress(json, "settlementToken", SETTLEMENT_TOKEN);
        string memory out = vm.serializeAddress(json, "creditPassport", address(passport));
        vm.writeJson(out, "deployments/local.json");
    }

    function _invoice(
        CreditPassport passport,
        address payer,
        string memory invoiceRef,
        uint256 amount,
        uint64 dueBlock,
        uint64 paidBlock
    ) internal {
        bytes memory txBytes = TxEncoder.encodeType2(
            payer,
            RAIL,
            TxEncoder.one(
                TxEncoder.invoicePaidLog(
                    RAIL, keccak256(bytes(invoiceRef)), payer, MERCHANT, amount, dueBlock, paidBlock
                )
            ),
            1
        );
        INativeQueryVerifier.MerkleProof memory mp = TxEncoder.merkleProofFor(nextIndex++ % 8);
        INativeQueryVerifier.ContinuityProof memory cp = TxEncoder.continuity(keccak256("ok"));
        passport.execute(
            uint8(CreditPassport.Action.InvoicePaid),
            CHAIN_KEY,
            paidBlock,
            txBytes,
            mp.root,
            mp.siblings,
            cp.lowerEndpointDigest,
            cp.roots
        );
    }

    /// @dev Two invoices imported in one batch to exercise `executeBatch` in the demo.
    function _batch(CreditPassport passport, address payer, uint64 startBlock) internal {
        uint64[] memory heights = new uint64[](2);
        bytes[] memory txs = new bytes[](2);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);

        heights[0] = startBlock;
        txs[0] = TxEncoder.encodeType2(
            payer,
            RAIL,
            TxEncoder.one(
                TxEncoder.invoicePaidLog(
                    RAIL, keccak256("ALICE-0004"), payer, MERCHANT, 310e6, startBlock + 200, startBlock
                )
            ),
            1
        );
        proofs[0] = TxEncoder.merkleProofFor(nextIndex++ % 8);

        heights[1] = startBlock + 600;
        txs[1] = TxEncoder.encodeType2(
            payer,
            RAIL,
            TxEncoder.one(
                TxEncoder.invoicePaidLog(
                    RAIL, keccak256("ALICE-0005"), payer, MERCHANT, 205e6, startBlock + 800, startBlock + 600
                )
            ),
            1
        );
        proofs[1] = TxEncoder.merkleProofFor(nextIndex++ % 8);

        passport.executeBatch(
            uint8(CreditPassport.Action.InvoicePaid),
            CHAIN_KEY,
            heights,
            txs,
            proofs,
            TxEncoder.continuity(keccak256("ok"))
        );
    }
}
