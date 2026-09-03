#!/usr/bin/env node
/**
 * When an Ethereum address appears, inspect public balances and, if Base
 * USDC is present, run the Agent Bounties readiness check. Does not sign
 * or move funds. Writes /tmp/funded-acquisition-status.json.
 *
 * Usage: node scripts/watch-funded-acquisition.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const home = path.join(os.homedir(), ".phantom-mcp");
const out = "/tmp/funded-acquisition-status.json";
const here = path.dirname(fileURLToPath(import.meta.url));
const ETH = /^0x[0-9a-fA-F]{40}$/;

function currentAddress() {
  for (const file of [path.join(home, "addresses.json"), path.join(home, "user-provided.json")]) {
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

function run(script, args = []) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(here, script), ...args], { stdio: "ignore" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function writeStatus(obj) {
  fs.writeFileSync(out, JSON.stringify({ ...obj, t: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify(obj));
}

let lastKey = "";
while (true) {
  const address = currentAddress();
  const session = fs.existsSync(path.join(home, "session.json"));
  if (!address) {
    if (lastKey !== "none") {
      writeStatus({ ok: false, stage: "no-address", session });
      lastKey = "none";
    }
    await new Promise((r) => setTimeout(r, 8000));
    continue;
  }
  await run("inspect-user-balances.mjs", [address]);
  let balances = null;
  try {
    balances = JSON.parse(fs.readFileSync("/tmp/user-wallet-balances.json", "utf8"));
  } catch {
    balances = null;
  }
  const baseUsdc = Number(balances?.chains?.base?.usdc || 0);
  const baseEth = Number(balances?.chains?.base?.native || 0);
  const fundedEnough = baseUsdc >= 1.02 && baseEth > 0;
  if (fundedEnough || baseUsdc > 0) {
    await run("agent-bounties-readiness.mjs", [address]);
  }
  let readiness = null;
  try {
    readiness = JSON.parse(fs.readFileSync("/tmp/agent-bounties-readiness.json", "utf8"));
  } catch {
    readiness = null;
  }
  const key = `${address}:${baseUsdc}:${baseEth}:${session}:${readiness?.ready || false}`;
  if (key !== lastKey) {
    writeStatus({
      ok: true,
      stage: !session && fundedEnough ? "funded-no-signer" : fundedEnough ? "funded" : "address-unfunded",
      address,
      session,
      baseUsdc,
      baseEth,
      ready: Boolean(readiness?.ready),
      canSign: session,
    });
    lastKey = key;
  }
  await new Promise((r) => setTimeout(r, 15000));
}
