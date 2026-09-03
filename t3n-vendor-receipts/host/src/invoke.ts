import {
  getContractVersion,
  getNodeUrl,
} from "@terminal3/t3n-sdk";

import { connect } from "./client.ts";
import { tenantIdFromDid } from "./session.ts";

const CONTRACT_TAIL = "vendor-receipts";

const { t3n: agentClient, did: agentDid } = await connect("T3N_AGENT_KEY");
const tenantDid = process.env.T3N_TENANT_DID;
if (!tenantDid) {
  throw new Error(
    "T3N_TENANT_DID is missing. Copy the did:t3n:… printed by npm run quickstart. Never invent it from a wallet address.",
  );
}

const scriptName = `z:${tenantIdFromDid(tenantDid)}:${CONTRACT_TAIL}`;
const scriptVersion = await getContractVersion(getNodeUrl(), scriptName);

const sample = {
  vendor: "Acme Supplies",
  invoice_id: "INV-1001",
  amount: "100.10",
  currency: "usd",
  issued_at: "2026-09-03",
};

const filed = await agentClient.executeAndDecode({
  contract_id: scriptName,
  contract_version: scriptVersion,
  function_name: "file-receipt",
  input: sample,
});
console.log("file-receipt", filed);

const listed = await agentClient.executeAndDecode({
  contract_id: scriptName,
  contract_version: scriptVersion,
  function_name: "list-receipts",
  input: {},
});
console.log("list-receipts", listed);

const verified = await agentClient.executeAndDecode({
  contract_id: scriptName,
  contract_version: scriptVersion,
  function_name: "verify-receipt",
  input: { id: filed.id, ...sample },
});
console.log("verify-receipt", verified);
console.log("agentDid", agentDid);
console.log(
  "This contract has no outbound HTTP, so no agent-auth-update grant is required for file/get/list/verify.",
);
