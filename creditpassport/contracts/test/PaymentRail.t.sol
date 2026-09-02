// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {PaymentRail} from "../src/source/PaymentRail.sol";
import {TestUSD} from "../src/TestUSD.sol";

contract PaymentRailTest is Test {
    TestUSD internal tUSD;
    PaymentRail internal rail;
    address internal payer = makeAddr("payer");
    address internal payee = makeAddr("payee");

    function setUp() public {
        tUSD = new TestUSD("Test USD", "tUSD");
        rail = new PaymentRail(tUSD);
        tUSD.mint(payer, 1_000e6);
        vm.prank(payer);
        tUSD.approve(address(rail), type(uint256).max);
    }

    function test_payInvoice_movesTokensAndEmits() public {
        vm.roll(500);
        vm.expectEmit(true, true, true, true, address(rail));
        emit PaymentRail.InvoicePaid(bytes32("INV-1"), payer, payee, 250e6, 600, 500);

        vm.prank(payer);
        rail.payInvoice(bytes32("INV-1"), payee, 250e6, 600);

        assertEq(tUSD.balanceOf(payee), 250e6);
        assertEq(tUSD.balanceOf(payer), 750e6);
        assertTrue(rail.settled(rail.settlementKey(payee, bytes32("INV-1"))));
    }

    function test_payInvoice_rejectsDuplicatePerPayee() public {
        vm.startPrank(payer);
        rail.payInvoice(bytes32("INV-1"), payee, 1e6, 600);
        vm.expectRevert(abi.encodeWithSelector(PaymentRail.InvoiceAlreadySettled.selector, payee, bytes32("INV-1")));
        rail.payInvoice(bytes32("INV-1"), payee, 1e6, 600);
        vm.stopPrank();
    }

    function test_payInvoice_sameIdDifferentPayeeIsAllowed() public {
        address other = makeAddr("other");
        vm.startPrank(payer);
        rail.payInvoice(bytes32("INV-1"), payee, 1e6, 600);
        rail.payInvoice(bytes32("INV-1"), other, 1e6, 600);
        vm.stopPrank();
        assertEq(tUSD.balanceOf(other), 1e6);
    }

    function test_payInvoice_validation() public {
        vm.startPrank(payer);
        vm.expectRevert(PaymentRail.ZeroAddress.selector);
        rail.payInvoice(bytes32("INV-1"), address(0), 1e6, 600);
        vm.expectRevert(PaymentRail.ZeroAmount.selector);
        rail.payInvoice(bytes32("INV-1"), payee, 0, 600);
        vm.stopPrank();
    }

    function test_testUSD_mintCap() public {
        vm.expectRevert(abi.encodeWithSelector(TestUSD.MintTooLarge.selector, 1_000_000e6 + 1));
        tUSD.mint(payer, 1_000_000e6 + 1);
        assertEq(tUSD.decimals(), 6);
    }
}
