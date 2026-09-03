#!/usr/bin/env bash
# Waits for the deployer address to be funded on both testnets, then runs deploy-testnet.sh once.
# Meant to sit in a tmux window while the faucet steps happen elsewhere.
#
# Usage: scripts/wait-for-funds.sh            # key from $TESTNET_DEPLOYER_PRIVATE_KEY or ~/.creditpassport/deployer.env
#        INTERVAL=30 scripts/wait-for-funds.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
: "${SEPOLIA_RPC_URL:=https://ethereum-sepolia-rpc.publicnode.com}"
: "${CREDITCOIN_RPC_URL:=https://rpc.cc3-testnet.creditcoin.network}"
export SEPOLIA_RPC_URL CREDITCOIN_RPC_URL
INTERVAL=${INTERVAL:-60}
MIN_SEPOLIA_WEI=${MIN_SEPOLIA_WEI:-10000000000000000}
MIN_CTC_WEI=${MIN_CTC_WEI:-50000000000000000}
export MIN_SEPOLIA_WEI MIN_CTC_WEI

if [ -z "${TESTNET_DEPLOYER_PRIVATE_KEY:-}" ] && [ -f "$HOME/.creditpassport/deployer.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HOME/.creditpassport/deployer.env"
  set +a
fi
[ -n "${TESTNET_DEPLOYER_PRIVATE_KEY:-}" ] || { echo "TESTNET_DEPLOYER_PRIVATE_KEY is not set" >&2; exit 1; }
DEPLOYER=$(cast wallet address --private-key "$TESTNET_DEPLOYER_PRIVATE_KEY")
echo "watching $DEPLOYER (need >= $(cast from-wei "$MIN_SEPOLIA_WEI") Sepolia ETH and >= $(cast from-wei "$MIN_CTC_WEI") tCTC)"

while true; do
  SEP=$(cast balance --rpc-url "$SEPOLIA_RPC_URL" "$DEPLOYER" 2>/dev/null || echo "")
  CTC=$(cast balance --rpc-url "$CREDITCOIN_RPC_URL" "$DEPLOYER" 2>/dev/null || echo "")
  if [ -z "$SEP" ] || [ -z "$CTC" ]; then
    echo "$(date -u +%FT%TZ) rpc error (sepolia='${SEP}' cc3='${CTC}'), retrying"
    sleep "$INTERVAL"
    continue
  fi
  echo "$(date -u +%FT%TZ) sepolia $(cast from-wei "$SEP") ETH  cc3 $(cast from-wei "$CTC") tCTC"
  if [ "$SEP" -ge "$MIN_SEPOLIA_WEI" ] && [ "$CTC" -ge "$MIN_CTC_WEI" ]; then
    echo "funded; deploying"
    if "$ROOT/scripts/deploy-testnet.sh"; then
      date -u +%FT%TZ > "$ROOT/contracts/deployments/.deployed-at"
      echo "DEPLOYED"
      exit 0
    fi
    echo "deploy failed; retrying in 10 minutes"
    sleep 600
    continue
  fi
  sleep "$INTERVAL"
done
