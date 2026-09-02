// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {AttestedBase} from "../src/AttestedBase.sol";
import {CreditPassport} from "../src/CreditPassport.sol";
import {TestUSD} from "../src/TestUSD.sol";
import {MockNativeQueryVerifier} from "./mocks/MockNativeQueryVerifier.sol";
import {TxEncoder} from "./helpers/TxEncoder.sol";

contract CreditPassportTest is Test {
    using TxEncoder for TxEncoder.LogEntryTuple;

    address internal constant VERIFIER_ADDR = 0x0000000000000000000000000000000000000FD2;
    uint64 internal constant CHAIN_KEY = 1;

    address internal rail = makeAddr("paymentRail");
    address internal settlementToken = makeAddr("settlementToken");
    address internal spoof = makeAddr("spoofRail");
    address internal agent = makeAddr("agent");
    address internal alice = makeAddr("alice");
    address internal merchant = makeAddr("merchant");

    TestUSD internal cUSD;
    CreditPassport internal passport;
    bytes32 internal okDigest = keccak256("ok");
    bytes32 internal failDigest;

    function setUp() public {
        MockNativeQueryVerifier mock = new MockNativeQueryVerifier();
        vm.etch(VERIFIER_ADDR, address(mock).code);
        failDigest = mock.FAIL_DIGEST();

        cUSD = new TestUSD("Credit USD", "cUSD");
        passport = new CreditPassport(CHAIN_KEY, cUSD, address(this));
        cUSD.mint(address(passport), 1_000_000e6);

        passport.setSources(rail, settlementToken);
        passport.setAgent(agent);
    }

    // ------------------------------------------------------------------ helpers

    function _invoiceTx(address emitter, bytes32 invoiceId, uint256 amount, uint64 dueBlock, uint64 paidBlock)
        internal
        view
        returns (bytes memory)
    {
        return TxEncoder.encodeType2(
            alice,
            emitter,
            TxEncoder.one(TxEncoder.invoicePaidLog(emitter, invoiceId, alice, merchant, amount, dueBlock, paidBlock)),
            1
        );
    }

    function _execute(uint8 action, uint64 height, uint64 txIndex, bytes memory encodedTx, bytes32 digest)
        internal
        returns (bool)
    {
        INativeQueryVerifier.MerkleProof memory mp = TxEncoder.merkleProofFor(txIndex);
        INativeQueryVerifier.ContinuityProof memory cp = TxEncoder.continuity(digest);
        return
            passport.execute(
                action, CHAIN_KEY, height, encodedTx, mp.root, mp.siblings, cp.lowerEndpointDigest, cp.roots
            );
    }

    function _queryId(uint64 height, uint64 txIndex) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(uint256(CHAIN_KEY), height, uint256(txIndex)));
    }

    // ------------------------------------------------------------------ single proof

    function test_execute_recordsOnTimeInvoice() public {
        bytes memory encodedTx = _invoiceTx(rail, bytes32("INV-1"), 500e6, 1000, 990);

        vm.expectEmit(true, true, true, true, address(passport));
        emit CreditPassport.PaymentVerified(alice, merchant, bytes32("INV-1"), 500e6, 1000, 990, true, _queryId(990, 3));

        assertTrue(_execute(uint8(CreditPassport.Action.InvoicePaid), 990, 3, encodedTx, okDigest));

        CreditPassport.Profile memory p = passport.getProfile(alice);
        assertEq(p.datedVolume, 500e6);
        assertEq(p.onTimeCount, 1);
        assertEq(p.lateCount, 0);
        assertEq(p.firstPaidBlock, 990);
        assertEq(p.lastPaidBlock, 990);
        assertEq(passport.paymentCount(alice), 1);
        assertTrue(passport.processedQueries(_queryId(990, 3)));

        CreditPassport.Payment[] memory payments = passport.getPayments(alice);
        assertEq(payments[0].payee, merchant);
        assertEq(payments[0].invoiceId, bytes32("INV-1"));
        assertEq(payments[0].queryId, _queryId(990, 3));
    }

    function test_execute_recordsLateInvoice() public {
        bytes memory encodedTx = _invoiceTx(rail, bytes32("INV-2"), 100e6, 1000, 1001);
        _execute(uint8(CreditPassport.Action.InvoicePaid), 1001, 0, encodedTx, okDigest);

        CreditPassport.Profile memory p = passport.getProfile(alice);
        assertEq(p.onTimeCount, 0);
        assertEq(p.lateCount, 1);
        assertEq(p.datedVolume, 100e6);
    }

    function test_execute_rejectsReplay() public {
        bytes memory encodedTx = _invoiceTx(rail, bytes32("INV-1"), 500e6, 1000, 990);
        _execute(uint8(CreditPassport.Action.InvoicePaid), 990, 3, encodedTx, okDigest);

        vm.expectRevert(abi.encodeWithSelector(AttestedBase.QueryAlreadyProcessed.selector, _queryId(990, 3)));
        _execute(uint8(CreditPassport.Action.InvoicePaid), 990, 3, encodedTx, okDigest);
    }

    function test_execute_rejectsWrongSourceChain() public {
        bytes memory encodedTx = _invoiceTx(rail, bytes32("INV-1"), 500e6, 1000, 990);
        INativeQueryVerifier.MerkleProof memory mp = TxEncoder.merkleProofFor(1);
        INativeQueryVerifier.ContinuityProof memory cp = TxEncoder.continuity(okDigest);

        vm.expectRevert(abi.encodeWithSelector(AttestedBase.WrongSourceChain.selector, uint64(3), CHAIN_KEY));
        passport.execute(0, 3, 990, encodedTx, mp.root, mp.siblings, cp.lowerEndpointDigest, cp.roots);
    }

    function test_execute_rejectsFailedVerificationWithoutStateChange() public {
        bytes memory encodedTx = _invoiceTx(rail, bytes32("INV-1"), 500e6, 1000, 990);

        vm.expectRevert(AttestedBase.ProofVerificationFailed.selector);
        _execute(uint8(CreditPassport.Action.InvoicePaid), 990, 3, encodedTx, failDigest);

        assertFalse(passport.processedQueries(_queryId(990, 3)));
        assertEq(passport.paymentCount(alice), 0);
    }

    function test_execute_ignoresLookAlikeEmitterAndRevertsWhenNothingFromRail() public {
        bytes memory encodedTx = _invoiceTx(spoof, bytes32("INV-X"), 1_000_000e6, 1000, 990);

        vm.expectRevert(CreditPassport.NoMatchingLogs.selector);
        _execute(uint8(CreditPassport.Action.InvoicePaid), 990, 1, encodedTx, okDigest);
    }

    function test_execute_recordsOnlyRailLogsWhenMixed() public {
        TxEncoder.LogEntryTuple[] memory logs = TxEncoder.two(
            TxEncoder.invoicePaidLog(spoof, bytes32("FAKE"), alice, merchant, 1_000_000e6, 1000, 990),
            TxEncoder.invoicePaidLog(rail, bytes32("REAL"), alice, merchant, 50e6, 1000, 990)
        );
        bytes memory encodedTx = TxEncoder.encodeType2(alice, rail, logs, 1);
        _execute(uint8(CreditPassport.Action.InvoicePaid), 990, 2, encodedTx, okDigest);

        assertEq(passport.paymentCount(alice), 1);
        assertEq(passport.getProfile(alice).datedVolume, 50e6);
    }

    function test_execute_rejectsFailedSourceTransaction() public {
        bytes memory encodedTx = TxEncoder.encodeType2(
            alice, rail, TxEncoder.one(TxEncoder.invoicePaidLog(rail, bytes32("INV-1"), alice, merchant, 5e6, 10, 9)), 0
        );
        vm.expectRevert(CreditPassport.SourceTransactionFailed.selector);
        _execute(uint8(CreditPassport.Action.InvoicePaid), 9, 0, encodedTx, okDigest);
    }

    function test_execute_rejectsUnknownAction() public {
        bytes memory encodedTx = _invoiceTx(rail, bytes32("INV-1"), 500e6, 1000, 990);
        vm.expectRevert(abi.encodeWithSelector(CreditPassport.InvalidAction.selector, uint8(9)));
        _execute(9, 990, 3, encodedTx, okDigest);
    }

    function test_execute_rejectsWhenSourcesUnset() public {
        CreditPassport fresh = new CreditPassport(CHAIN_KEY, cUSD, address(this));
        bytes memory encodedTx = _invoiceTx(rail, bytes32("INV-1"), 500e6, 1000, 990);
        INativeQueryVerifier.MerkleProof memory mp = TxEncoder.merkleProofFor(1);
        INativeQueryVerifier.ContinuityProof memory cp = TxEncoder.continuity(okDigest);

        vm.expectRevert(CreditPassport.SourcesNotSet.selector);
        fresh.execute(0, CHAIN_KEY, 990, encodedTx, mp.root, mp.siblings, cp.lowerEndpointDigest, cp.roots);
    }

    function test_execute_recordsTokenTransferAndSkipsMint() public {
        TxEncoder.LogEntryTuple[] memory logs = TxEncoder.two(
            TxEncoder.transferLog(settlementToken, address(0), alice, 1_000e6),
            TxEncoder.transferLog(settlementToken, alice, merchant, 120e6)
        );
        bytes memory encodedTx = TxEncoder.encodeType2(alice, settlementToken, logs, 1);
        _execute(uint8(CreditPassport.Action.TokenTransfer), 4242, 5, encodedTx, okDigest);

        CreditPassport.Profile memory p = passport.getProfile(alice);
        assertEq(p.undatedVolume, 120e6);
        assertEq(p.transferCount, 1);
        assertEq(p.datedVolume, 0);
        assertEq(p.firstPaidBlock, 4242);
        assertEq(passport.paymentCount(alice), 1);
        assertEq(passport.getPayments(alice)[0].paidBlock, 4242);
    }

    function test_execute_transferFromOtherTokenIsNotCounted() public {
        bytes memory encodedTx =
            TxEncoder.encodeType2(alice, spoof, TxEncoder.one(TxEncoder.transferLog(spoof, alice, merchant, 120e6)), 1);
        vm.expectRevert(CreditPassport.NoMatchingLogs.selector);
        _execute(uint8(CreditPassport.Action.TokenTransfer), 4242, 5, encodedTx, okDigest);
    }

    // ------------------------------------------------------------------ batch

    function test_executeBatch_recordsAllAndSkipsDuplicates() public {
        uint64[] memory heights = new uint64[](3);
        bytes[] memory txs = new bytes[](3);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](3);

        heights[0] = 100;
        txs[0] = _invoiceTx(rail, bytes32("A"), 10e6, 200, 100);
        proofs[0] = TxEncoder.merkleProofFor(0);

        heights[1] = 150;
        txs[1] = _invoiceTx(rail, bytes32("B"), 20e6, 200, 150);
        proofs[1] = TxEncoder.merkleProofFor(1);

        // Duplicate of entry 0 inside the same batch.
        heights[2] = 100;
        txs[2] = txs[0];
        proofs[2] = proofs[0];

        uint256 processed = passport.executeBatch(
            uint8(CreditPassport.Action.InvoicePaid), CHAIN_KEY, heights, txs, proofs, TxEncoder.continuity(okDigest)
        );
        assertEq(processed, 2);
        assertEq(passport.paymentCount(alice), 2);
        assertEq(passport.getProfile(alice).datedVolume, 30e6);

        // Re-submitting the whole batch has nothing new.
        vm.expectRevert(AttestedBase.NothingNewInBatch.selector);
        passport.executeBatch(
            uint8(CreditPassport.Action.InvoicePaid), CHAIN_KEY, heights, txs, proofs, TxEncoder.continuity(okDigest)
        );
    }

    function test_executeBatch_partialOverlapProcessesOnlyNew() public {
        bytes memory first = _invoiceTx(rail, bytes32("A"), 10e6, 200, 100);
        _execute(uint8(CreditPassport.Action.InvoicePaid), 100, 0, first, okDigest);

        uint64[] memory heights = new uint64[](2);
        bytes[] memory txs = new bytes[](2);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        heights[0] = 100;
        txs[0] = first;
        proofs[0] = TxEncoder.merkleProofFor(0);
        heights[1] = 160;
        txs[1] = _invoiceTx(rail, bytes32("C"), 5e6, 100, 160);
        proofs[1] = TxEncoder.merkleProofFor(2);

        uint256 processed = passport.executeBatch(
            uint8(CreditPassport.Action.InvoicePaid), CHAIN_KEY, heights, txs, proofs, TxEncoder.continuity(okDigest)
        );
        assertEq(processed, 1);
        CreditPassport.Profile memory p = passport.getProfile(alice);
        assertEq(p.onTimeCount, 1);
        assertEq(p.lateCount, 1);
    }

    function test_executeBatch_validation() public {
        uint64[] memory heights = new uint64[](0);
        bytes[] memory txs = new bytes[](0);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](0);
        vm.expectRevert(AttestedBase.EmptyBatch.selector);
        passport.executeBatch(0, CHAIN_KEY, heights, txs, proofs, TxEncoder.continuity(okDigest));

        heights = new uint64[](11);
        txs = new bytes[](11);
        proofs = new INativeQueryVerifier.MerkleProof[](11);
        vm.expectRevert(abi.encodeWithSelector(AttestedBase.BatchTooLarge.selector, 11));
        passport.executeBatch(0, CHAIN_KEY, heights, txs, proofs, TxEncoder.continuity(okDigest));

        heights = new uint64[](2);
        txs = new bytes[](1);
        proofs = new INativeQueryVerifier.MerkleProof[](2);
        vm.expectRevert(AttestedBase.BatchLengthMismatch.selector);
        passport.executeBatch(0, CHAIN_KEY, heights, txs, proofs, TxEncoder.continuity(okDigest));
    }

    function test_executeBatch_failedVerificationLeavesNoState() public {
        uint64[] memory heights = new uint64[](1);
        bytes[] memory txs = new bytes[](1);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        heights[0] = 100;
        txs[0] = _invoiceTx(rail, bytes32("A"), 10e6, 200, 100);
        proofs[0] = TxEncoder.merkleProofFor(0);

        vm.expectRevert(AttestedBase.ProofVerificationFailed.selector);
        passport.executeBatch(0, CHAIN_KEY, heights, txs, proofs, TxEncoder.continuity(failDigest));
        assertFalse(passport.processedQueries(_queryId(100, 0)));
    }

    // ------------------------------------------------------------------ policy

    function _seedHistory(uint32 onTime, uint32 late, uint256 amountEach) internal {
        uint64 idx;
        for (uint32 i; i < onTime; ++i) {
            bytes memory txb = _invoiceTx(rail, keccak256(abi.encode("on", i)), amountEach, 1000, 900);
            _execute(0, 900 + idx, idx % 8, txb, okDigest);
            ++idx;
        }
        for (uint32 i; i < late; ++i) {
            bytes memory txb = _invoiceTx(rail, keccak256(abi.encode("late", i)), amountEach, 1000, 1100);
            _execute(0, 1100 + idx, idx % 8, txb, okDigest);
            ++idx;
        }
    }

    function test_maxCreditLimit_zeroWithoutHistory() public view {
        assertEq(passport.maxCreditLimit(alice), 0);
    }

    function test_maxCreditLimit_halfOfVolumeScaledByOnTimeRatio() public {
        _seedHistory(3, 1, 100e6); // 400 volume, 75% on time
        // 50% of 400 = 200, scaled by 3/4 = 150
        assertEq(passport.maxCreditLimit(alice), 150e6);
    }

    function test_maxCreditLimit_zeroDatedWhenMostlyLate() public {
        _seedHistory(1, 2, 100e6);
        assertEq(passport.maxCreditLimit(alice), 0);
    }

    function test_maxCreditLimit_undatedVolumeQuarterWeight() public {
        bytes memory encodedTx = TxEncoder.encodeType2(
            alice, settlementToken, TxEncoder.one(TxEncoder.transferLog(settlementToken, alice, merchant, 400e6)), 1
        );
        _execute(uint8(CreditPassport.Action.TokenTransfer), 4242, 5, encodedTx, okDigest);
        // 50% * 50% of 400 = 100
        assertEq(passport.maxCreditLimit(alice), 100e6);
    }

    // ------------------------------------------------------------------ underwriting and credit line

    function test_underwrite_onlyAgent() public {
        vm.expectRevert(CreditPassport.NotAgent.selector);
        passport.underwrite(alice, 700, 0, "");
    }

    function test_underwrite_enforcesScoreAndPolicy() public {
        _seedHistory(2, 0, 100e6); // cap = 100

        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(CreditPassport.ScoreOutOfRange.selector, uint16(1001)));
        passport.underwrite(alice, 1001, 10e6, "");

        vm.expectRevert(abi.encodeWithSelector(CreditPassport.LimitExceedsPolicy.selector, 100e6 + 1, 100e6));
        passport.underwrite(alice, 800, 100e6 + 1, "");

        vm.expectEmit(true, false, false, true, address(passport));
        emit CreditPassport.Underwritten(alice, 800, 100e6, 100e6, "data:text/plain,memo");
        passport.underwrite(alice, 800, 100e6, "data:text/plain,memo");
        vm.stopPrank();

        CreditPassport.Profile memory p = passport.getProfile(alice);
        assertEq(p.score, 800);
        assertEq(p.creditLimit, 100e6);
        assertEq(p.memoURI, "data:text/plain,memo");
        assertEq(p.underwrittenAt, uint64(block.number));
    }

    function test_drawAndRepay() public {
        _seedHistory(2, 0, 100e6);
        vm.prank(agent);
        passport.underwrite(alice, 800, 100e6, "");

        assertEq(passport.availableCredit(alice), 100e6);

        vm.startPrank(alice);
        passport.draw(60e6);
        assertEq(cUSD.balanceOf(alice), 60e6);
        assertEq(passport.availableCredit(alice), 40e6);

        vm.expectRevert(abi.encodeWithSelector(CreditPassport.ExceedsCreditLimit.selector, 41e6, 40e6));
        passport.draw(41e6);

        cUSD.approve(address(passport), type(uint256).max);
        passport.repay(100e6); // more than drawn: only the outstanding 60 is pulled
        assertEq(cUSD.balanceOf(alice), 0);
        assertEq(passport.getProfile(alice).drawn, 0);
        assertEq(passport.availableCredit(alice), 100e6);

        vm.expectRevert(CreditPassport.NothingToRepay.selector);
        passport.repay(1);
        vm.stopPrank();
    }

    function test_underwrite_cannotSetLimitBelowDrawn() public {
        _seedHistory(2, 0, 100e6);
        vm.prank(agent);
        passport.underwrite(alice, 800, 100e6, "");
        vm.prank(alice);
        passport.draw(70e6);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(CreditPassport.LimitBelowDrawn.selector, 50e6, 70e6));
        passport.underwrite(alice, 500, 50e6, "");
    }

    function test_adminGuards() public {
        vm.prank(alice);
        vm.expectRevert();
        passport.setAgent(alice);

        vm.expectRevert(CreditPassport.ZeroAddress.selector);
        passport.setSources(address(0), settlementToken);

        passport.withdrawCreditToken(merchant, 5e6);
        assertEq(cUSD.balanceOf(merchant), 5e6);
    }
}
