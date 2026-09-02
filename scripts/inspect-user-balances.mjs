#!/usr/bin/env node
/**
 * Read a public Ethereum address from ~/.phantom-mcp/user-provided.json or
 * addresses.json and write ETH/USDC balances to /tmp/user-wallet-balances.json.
 * Does not print or request keys.
 *
 * Usage: node scripts/inspect-user-balances.mjs [0xaddress]
 */
import fs from "fs";
import os from "os";
import path from "path";

const ETH = /^0x[0-9a-fA-F]{40}$/;
const USDC = {
  ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};
const RPC = {
  ethereum: "https://ethereum.publicnode.com",
  base: "https://mainnet.base.org",
};

function hexToDecimal(hex, decimals) {
  const raw = String(hex).replace(/^0x/i, "") || "0";
  const value = BigInt(`0x${raw}`);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (!res.ok || body.error || typeof body.result !== "string") {
    throw new Error(body.error?.message || `${method} failed`);
  }
  return body.result;
}

function readAddress(cli) {
  if (cli && ETH.test(cli)) return cli;
  for (const file of [
    path.join(os.homedir(), ".phantom-mcp", "addresses.json"),
    path.join(os.homedir(), ".phantom-mcp", "user-provided.json"),
  ]) {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      const addr = j.ethereum || j.ethereumAddress;
      if (addr && ETH.test(addr)) return addr;
    } catch {
      /* next */
    }
  }
  return null;
}

const address = readAddress(process.argv[2]);
if (!address) {
  console.log(JSON.stringify({ ok: false, error: "no-ethereum-address" }));
  process.exit(2);
}

const chains = {};
for (const [chain, url] of Object.entries(RPC)) {
  try {
    const [nativeHex, usdcHex] = await Promise.all([
      rpc(url, "eth_getBalance", [address, "latest"]),
      rpc(url, "eth_call", [
        { to: USDC[chain], data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}` },
        "latest",
      ]),
    ]);
    chains[chain] = {
      native: hexToDecimal(nativeHex, 18),
      usdc: hexToDecimal(usdcHex, 6),
      ok: true,
    };
  } catch (error) {
    chains[chain] = {
      native: "0",
      usdc: "0",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const funded = Object.values(chains).some(
  (c) => c.ok && (Number(c.native) > 0 || Number(c.usdc) > 0),
);
const report = {
  ok: true,
  address,
  checkedAt: new Date().toISOString(),
  chains,
  funded,
};
fs.writeFileSync("/tmp/user-wallet-balances.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
