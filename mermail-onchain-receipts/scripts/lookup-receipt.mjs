#!/usr/bin/env node
// Read-only receipt lookup for mermail-onchain-receipts. No wallet. No send.
// Usage: node scripts/lookup-receipt.mjs 0x<64-hex> [0x...]
import { extractHashes, lookupHashes } from "./lib.mjs";

const args = process.argv.slice(2);
const hashes = args.flatMap((a) => extractHashes(a));
if (!hashes.length) {
  console.error("usage: node scripts/lookup-receipt.mjs 0x<64-hex> [...]");
  process.exit(2);
}
const rows = await lookupHashes(hashes);
console.log(JSON.stringify(rows, null, 2));
const bad = rows.filter((r) => r.status === "ambiguous");
process.exit(bad.length ? 3 : 0);
