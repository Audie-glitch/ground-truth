// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {CreditPassport} from "../src/CreditPassport.sol";
import {TestUSD} from "../src/TestUSD.sol";

/// @notice Deploys the Creditcoin side (credit token + passport), funds the credit pool, and binds the
///         source-chain contracts from `deployments/source.json`. Run against Creditcoin CC3 testnet.
///
///         The passport trusts two source contracts: the PaymentRail (dated `InvoicePaid` logs) and a
///         settlement token whose plain `Transfer` logs count as undated payments. The latter defaults to
///         Circle's USDC on Sepolia so any address with real USDC activity can build a passport; override
///         with SETTLEMENT_TOKEN.
///
///   SOURCE_CHAIN_KEY=1 AGENT_ADDRESS=0x... \
///   forge script script/DeployPassport.s.sol --rpc-url creditcoin_testnet \
///     --private-key $TESTNET_DEPLOYER_PRIVATE_KEY --broadcast
contract DeployPassport is Script {
    function run() external {
        uint64 sourceChainKey = uint64(vm.envOr("SOURCE_CHAIN_KEY", uint256(1)));
        uint256 poolSize = vm.envOr("CREDIT_POOL", uint256(1_000_000e6));

        string memory source = vm.readFile("deployments/source.json");
        address rail = vm.parseJsonAddress(source, ".paymentRail");
        address railToken = vm.parseJsonAddress(source, ".railToken");
        address defaultSettlement = sourceChainKey == 1
            ? 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 // USDC on Ethereum Sepolia
            : railToken;
        address settlementToken = vm.envOr("SETTLEMENT_TOKEN", defaultSettlement);

        vm.startBroadcast();
        address deployer = msg.sender;
        address agent = vm.envOr("AGENT_ADDRESS", deployer);

        TestUSD cUSD = new TestUSD("Credit USD", "cUSD");
        CreditPassport passport = new CreditPassport(sourceChainKey, cUSD, deployer);
        cUSD.mint(address(passport), poolSize);
        passport.setSources(rail, settlementToken);
        passport.setAgent(agent);
        vm.stopBroadcast();

        console.log("chainId          ", block.chainid);
        console.log("sourceChainKey   ", sourceChainKey);
        console.log("TestUSD (cUSD)   ", address(cUSD));
        console.log("CreditPassport   ", address(passport));
        console.log("agent            ", agent);
        console.log("paymentRail      ", rail);
        console.log("railToken        ", railToken);
        console.log("settlementToken  ", settlementToken);

        string memory json = "passport";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "sourceChainKey", sourceChainKey);
        vm.serializeAddress(json, "creditToken", address(cUSD));
        vm.serializeAddress(json, "agent", agent);
        vm.serializeAddress(json, "paymentRail", rail);
        vm.serializeAddress(json, "railToken", railToken);
        vm.serializeAddress(json, "settlementToken", settlementToken);
        string memory out = vm.serializeAddress(json, "creditPassport", address(passport));
        vm.writeJson(out, "deployments/creditcoin.json");
    }
}
