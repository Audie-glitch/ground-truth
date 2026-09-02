#!/usr/bin/env bash
# Local demo: anvil standing in for Creditcoin, the mock verifier installed at the precompile
# address, and the Creditcoin side deployed and seeded with fabricated (but correctly encoded)
# proofs. Lets the web app and the CLI be exercised without testnet funds.
#
# Usage: scripts/demo-local.sh            # starts anvil in the background, seeds, prints addresses
#        ANVIL_PORT=48545 scripts/demo-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ANVIL_PORT:-48545}"
RPC="http://127.0.0.1:${PORT}"
VERIFIER=0x0000000000000000000000000000000000000FD2
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

export PATH="$HOME/.foundry/bin:$PATH"
command -v anvil >/dev/null || { echo "anvil not found; install Foundry (https://getfoundry.sh)"; exit 1; }

cd "$ROOT/contracts"
forge build --quiet

if ! curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC" >/dev/null 2>&1; then
  echo "starting anvil on $RPC"
  nohup anvil --port "$PORT" --chain-id 102031 --block-time 2 --silent >"$ROOT/contracts/anvil.log" 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

BYTECODE=$(node -e 'console.log(require("./out/MockNativeQueryVerifier.sol/MockNativeQueryVerifier.json").deployedBytecode.object)')
cast rpc --rpc-url "$RPC" anvil_setCode "$VERIFIER" "$BYTECODE" >/dev/null
echo "mock verifier installed at $VERIFIER"

forge script script/SeedLocal.s.sol --rpc-url "$RPC" --broadcast --private-key "$DEPLOYER_KEY" --silent 2>/dev/null \
  | grep -E "cUSD|CreditPassport|agent|alice|bob|chainId" || true

node scripts/export-abi.mjs >/dev/null
echo
echo "deployments written to contracts/deployments/local.json"
echo "web:   cd web && CREDITCOIN_RPC_URL=$RPC DEPLOYMENT=local npm run dev"
echo "agent: cd agent && CREDITCOIN_RPC_URL=$RPC npm run cli -- profile 0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
