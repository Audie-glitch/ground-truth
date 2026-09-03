import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";

import { connect } from "./client.ts";

const { t3n, did: tenantDid } = await connect("T3N_API_KEY");
console.log("Connected as:", tenantDid);

const tenant = new TenantClient({
  t3n,
  baseUrl: getNodeUrl(),
  tenantDid,
});
await tenant.tenant.me();
console.log("TenantClient ready.");
