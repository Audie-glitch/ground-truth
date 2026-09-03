import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";

import { connect } from "./client.ts";
import { tenantIdFromDid } from "./session.ts";

const CONTRACT_TAIL = "vendor-receipts";
const CONTRACT_VERSION = "0.1.0";
const MAP_TAIL = "receipts";

const here = dirname(fileURLToPath(import.meta.url));
const defaultWasm = resolve(
  here,
  "../../contract/target/wasm32-wasip2/release/z_vendor_receipts.wasm",
);

const { t3n, did: tenantDid } = await connect("T3N_API_KEY");
const tenant = new TenantClient({
  t3n,
  baseUrl: getNodeUrl(),
  tenantDid,
});
await tenant.tenant.me();

const wasmPath = process.env.WASM_PATH ?? defaultWasm;
const wasm = await readFile(wasmPath);

const result = await tenant.contracts.register({
  tail: CONTRACT_TAIL,
  version: CONTRACT_VERSION,
  wasm,
});

const contractId = result.contract_id;
const scriptName = `z:${tenantIdFromDid(tenantDid)}:${CONTRACT_TAIL}`;
console.log(`registered ${scriptName} as contract id ${contractId}`);

try {
  await tenant.maps.create({
    tail: MAP_TAIL,
    visibility: "private",
    writers: { only: [contractId] },
    readers: { only: [contractId] },
  });
  console.log(`map z:<tid>:${MAP_TAIL} ready (readers+writers = contract ${contractId})`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/already exists|MapAlreadyExists/i.test(message)) {
    console.log(`map ${MAP_TAIL} already exists — re-grant ACL if you just re-registered`);
    await tenant.maps.update(MAP_TAIL, {
      writers: { only: [contractId] },
      readers: { only: [contractId] },
    });
  } else {
    throw error;
  }
}
console.log("Keep this contract_id. Re-registering allocates a new id and stale ACLs.");
