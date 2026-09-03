#!/usr/bin/env node
/**
 * Wallet-neutral Agent Bounties readiness check for the live API-reliability
 * standing parent on Base. Does not print keys and does not send a claim.
 *
 * Usage: node scripts/agent-bounties-readiness.mjs [0xaddress]
 */
import fs from "fs";
import os from "os";
import path from "path";

const ETH = /^0x[0-9a-fA-F]{40}$/;
const PARENT = "0x71b7b3a8ceb534ca904b8513987aa1f3bd6c3d91";
const OUT = "/tmp/agent-bounties-readiness.json";
const CLAIM_BOND = "10000";

function readAddress(cli) {
  if (cli && ETH.test(cli)) return cli.toLowerCase();
  for (const file of [
    path.join(os.homedir(), ".phantom-mcp", "addresses.json"),
    path.join(os.homedir(), ".phantom-mcp", "user-provided.json"),
  ]) {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      const addr = j.ethereum || j.ethereumAddress;
      if (addr && ETH.test(addr)) return addr.toLowerCase();
    } catch {
      /* next */
    }
  }
  return null;
}

const address = readAddress(process.argv[2]);
if (!address) {
  const report = { ok: false, ready: false, error: "no-ethereum-address", checkedAt: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(2);
}

const res = await fetch("https://api.agentbounties.app/v1/base/agent-wallet/readiness", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    bounty_contract: PARENT,
    claim_bond_base_units: CLAIM_BOND,
    network: "base-mainnet",
    policy: {},
    signing_capabilities: [],
    wallet_address: address,
    wallet_profile: "generic-evm",
  }),
});
const body = await res.json().catch(() => ({}));
const report = {
  ok: res.ok,
  ready: Boolean(body.ready),
  status: body.status || (res.ok ? "unknown" : "http-error"),
  httpStatus: res.status,
  address,
  bountyContract: PARENT,
  onchainBountyStatus: body.onchain_bounty_status || null,
  observedUsdcBaseUnits: body.observed_usdc_balance_base_units || null,
  claimBondBaseUnits: body.claim_bond_base_units || CLAIM_BOND,
  recommendedClaimPath: body.recommended_claim_path || null,
  checks: Array.isArray(body.checks)
    ? body.checks.map((c) => ({ name: c.name, status: c.status, next: c.next_action || null }))
    : [],
  blocked: (body.checks || []).filter((c) => c.status && c.status !== "pass").map((c) => c.name),
  checkedAt: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, ready: report.ready, status: report.status, address, blocked: report.blocked }));
process.exit(report.ready ? 0 : 1);
