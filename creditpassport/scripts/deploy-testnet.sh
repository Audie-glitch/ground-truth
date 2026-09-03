#!/usr/bin/env bash
# Deploys CreditPassport to the public testnets: tUSD + PaymentRail on Ethereum Sepolia, then cUSD +
# CreditPassport on Creditcoin CC3 testnet (funds the credit pool, binds the source contracts, registers
# the agent), and exports the ABIs for the agent and the web app.
#
# Idempotent per side: a side whose deployments file already records the right chain id is skipped, so a
# run that fails halfway can simply be repeated.
#
# Usage: TESTNET_DEPLOYER_PRIVATE_KEY=0x... scripts/deploy-testnet.sh
#        The key may also live in ~/.creditpassport/deployer.env (KEY=VALUE lines). Testnet-only key;
#        never one that holds real funds.
# Env:   SEPOLIA_RPC_URL, CREDITCOIN_RPC_URL (defaults below), SOURCE_CHAIN_KEY (1 = Sepolia on CC3),
#        AGENT_ADDRESS (defaults to the deployer), MIN_SEPOLIA_WEI / MIN_CTC_WEI balance gates.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
: "${SEPOLIA_RPC_URL:=https://ethereum-sepolia-rpc.publicnode.com}"
: "${CREDITCOIN_RPC_URL:=https://rpc.cc3-testnet.creditcoin.network}"
: "${SOURCE_CHAIN_KEY:=1}"
export SEPOLIA_RPC_URL CREDITCOIN_RPC_URL SOURCE_CHAIN_KEY

if [ -z "${TESTNET_DEPLOYER_PRIVATE_KEY:-}" ] && [ -f "$HOME/.creditpassport/deployer.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HOME/.creditpassport/deployer.env"
  set +a
fi
[ -n "${TESTNET_DEPLOYER_PRIVATE_KEY:-}" ] || { echo "TESTNET_DEPLOYER_PRIVATE_KEY is not set" >&2; exit 1; }

DEPLOYER=$(cast wallet address --private-key "$TESTNET_DEPLOYER_PRIVATE_KEY")
SEPOLIA_WEI=$(cast balance --rpc-url "$SEPOLIA_RPC_URL" "$DEPLOYER")
CTC_WEI=$(cast balance --rpc-url "$CREDITCOIN_RPC_URL" "$DEPLOYER")
MIN_SEPOLIA_WEI=${MIN_SEPOLIA_WEI:-10000000000000000}   # 0.01 ETH: deploy is ~0.002 ETH at 2 gwei
MIN_CTC_WEI=${MIN_CTC_WEI:-50000000000000000}           # 0.05 tCTC: deploy is ~0.005 tCTC at 1 gwei

echo "deployer         $DEPLOYER"
echo "Sepolia balance  $(cast from-wei "$SEPOLIA_WEI") ETH"
echo "CC3 balance      $(cast from-wei "$CTC_WEI") tCTC"

cd "$ROOT/contracts"
forge build --quiet

json_chain() { node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).chainId)}catch{console.log("")}' "$1"; }

if [ "$(json_chain deployments/source.json)" = "11155111" ]; then
  echo "Sepolia side already deployed (deployments/source.json); skipping"
else
  if [ "$(cast to-dec "$SEPOLIA_WEI" 2>/dev/null || echo "$SEPOLIA_WEI")" -lt "$MIN_SEPOLIA_WEI" ]; then
    echo "Sepolia balance below $(cast from-wei "$MIN_SEPOLIA_WEI") ETH; fund $DEPLOYER first" >&2
    exit 2
  fi
  echo "== deploying tUSD + PaymentRail on Sepolia"
  forge script script/DeploySource.s.sol --rpc-url sepolia \
    --private-key "$TESTNET_DEPLOYER_PRIVATE_KEY" --broadcast --slow
fi

if [ "$(json_chain deployments/creditcoin.json)" = "102031" ]; then
  echo "Creditcoin side already deployed (deployments/creditcoin.json); skipping"
else
  if [ "$(cast to-dec "$CTC_WEI" 2>/dev/null || echo "$CTC_WEI")" -lt "$MIN_CTC_WEI" ]; then
    echo "CC3 balance below $(cast from-wei "$MIN_CTC_WEI") tCTC; fund $DEPLOYER first" >&2
    exit 2
  fi
  echo "== deploying cUSD + CreditPassport on Creditcoin CC3 testnet"
  # Creditcoin's RPC omits mixHash, so forge's fork simulation needs a pre-Merge EVM version (foundry.toml
  # already pins london). --slow waits for each receipt: nonces on CC3 are only safe sequentially.
  forge script script/DeployPassport.s.sol --rpc-url creditcoin_testnet \
    --private-key "$TESTNET_DEPLOYER_PRIVATE_KEY" --broadcast --slow
fi

node scripts/export-abi.mjs
echo
echo "deployments:"
cat deployments/source.json deployments/creditcoin.json
echo
echo "next: cd agent && npm run cli -- status   (AGENT_PRIVATE_KEY = the deployer key, see .env.example)"
