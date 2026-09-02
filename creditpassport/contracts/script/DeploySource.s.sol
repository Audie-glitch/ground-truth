// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {PaymentRail} from "../src/source/PaymentRail.sol";
import {TestUSD} from "../src/TestUSD.sol";

/// @notice Deploys the source-chain side (settlement token + payment rail). Run against Sepolia.
///
///   forge script script/DeploySource.s.sol --rpc-url sepolia \
///     --private-key $TESTNET_DEPLOYER_PRIVATE_KEY --broadcast
contract DeploySource is Script {
    function run() external {
        vm.startBroadcast();
        TestUSD token = new TestUSD("Test USD", "tUSD");
        PaymentRail rail = new PaymentRail(token);
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("TestUSD (tUSD)   ", address(token));
        console.log("PaymentRail      ", address(rail));

        string memory json = "source";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "settlementToken", address(token));
        string memory out = vm.serializeAddress(json, "paymentRail", address(rail));
        vm.writeJson(out, "./deployments/source.json");
    }
}
