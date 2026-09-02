// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {CreditPassport} from "../src/CreditPassport.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";
import {TxEncoder} from "./helpers/TxEncoder.sol";

/// @notice Runs the contract's decoding path over genuine prover output captured from the Creditcoin
///         testnet prover (`test/fixtures/sepolia-11622748-0.json`), so the encoder used by the other
///         tests is cross-checked against the real thing.
contract RealProverBytesTest is Test {
    string internal constant FIXTURE = "test/fixtures/sepolia-11622748-0.json";

    function _fixture() internal view returns (string memory json) {
        json = vm.readFile(FIXTURE);
    }

    function test_realTxBytes_decodeMatchesSepoliaReceipt() public view {
        string memory json = _fixture();
        bytes memory txBytes = vm.parseJsonBytes(json, ".txBytes");
        uint256 expectedType = vm.parseJsonUint(json, ".txType");
        uint256 expectedStatus = vm.parseJsonUint(json, ".receiptStatus");
        uint256 expectedLogs = vm.parseJsonUint(json, ".logCount");
        address expectedFrom = vm.parseJsonAddress(json, ".from");
        address expectedTo = vm.parseJsonAddress(json, ".to");

        uint8 txType = EvmV1Decoder.getTransactionType(txBytes);
        assertEq(txType, uint8(expectedType), "tx type");
        assertTrue(EvmV1Decoder.isValidTransactionType(txType));

        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(txBytes);
        assertEq(common.from, expectedFrom, "from");
        assertEq(common.to, expectedTo, "to");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(txBytes);
        assertEq(receipt.receiptStatus, uint8(expectedStatus), "status");
        assertEq(receipt.receiptLogs.length, expectedLogs, "log count");

        for (uint256 i; i < receipt.receiptLogs.length; ++i) {
            string memory base = string.concat(".logs[", vm.toString(i), "]");
            assertEq(
                receipt.receiptLogs[i].address_,
                vm.parseJsonAddress(json, string.concat(base, ".address")),
                "log address"
            );
            bytes32[] memory topics = vm.parseJsonBytes32Array(json, string.concat(base, ".topics"));
            assertEq(receipt.receiptLogs[i].topics.length, topics.length, "topic count");
            for (uint256 t; t < topics.length; ++t) {
                assertEq(receipt.receiptLogs[i].topics[t], topics[t], "topic");
            }
            assertEq(receipt.receiptLogs[i].data, vm.parseJsonBytes(json, string.concat(base, ".data")), "log data");
        }
    }

    /// @dev The real transaction is not an InvoicePaid; through `execute` it must reach the decoder,
    ///      pass the status check, and be rejected only for lacking a matching rail log.
    function test_realTxBytes_rejectedOnlyForMissingRailLog() public {
        string memory json = _fixture();
        bytes memory txBytes = vm.parseJsonBytes(json, ".txBytes");
        uint64 height = uint64(vm.parseJsonUint(json, ".headerNumber"));

        MockNativeQueryVerifier mock = new MockNativeQueryVerifier();
        vm.etch(0x0000000000000000000000000000000000000FD2, address(mock).code);
        TestUSD cUSD = new TestUSD("Credit USD", "cUSD");
        CreditPassport passport = new CreditPassport(1, cUSD, address(this));
        passport.setSources(makeAddr("rail"), makeAddr("token"));

        vm.expectRevert(CreditPassport.NoMatchingLogs.selector);
        passport.execute(
            uint8(CreditPassport.Action.InvoicePaid),
            1,
            height,
            txBytes,
            keccak256("root"),
            TxEncoder.siblingsFor(0),
            keccak256("ok"),
            new bytes32[](1)
        );
    }
}
