# T3N vendor receipts — design

**Listing:** [t3n-agent-build-challenge](https://superteam.fun/earn/listing/t3n-agent-build-challenge)  
**Prize:** 290 USDC (100 / 50 / 50 / 30 / 30 / 30), due 16 Sep 2026 15:59 UTC  
**Access:** `HUMAN_ONLY` — this repo ships the build; the participant submits.  
**Checked open:** 3 Sep 2026 ~03:00 UTC, 28 Superteam listings, this one still OPEN (74 submissions).

## Why this entry, not the flight showcase

The official walkthrough clones `z-tenant-flight` (Duffel HTTP + `secrets` + placeholders). Judges score **usefulness** and **ease of maintenance after the challenge**. A Duffel wrapper needs a third-party key, an HTTP allowlist grant, and three identities. This entry files **hashed vendor invoices inside the tenant KV map only**.

| Approach | Usefulness | Maintenance |
| --- | --- | --- |
| Clone and tweak Duffel flight booking | Demo-shaped; needs Duffel + PII profile | High: secrets rotation, egress grants, upstream API |
| **Vendor receipt vault (chosen)** | Finance/AP can prove an invoice was filed without leaving the TEE | Low: no HTTP, no secrets map, native tests cover the logic |
| Payroll / outbound payments | Stronger product, but needs signing + HTTP | High; more surface than the deadline rewards |

## What it is

An enterprise TEE contract for a tenant's accounts-payable desk.

- **file-receipt** — store vendor, invoice id, amount, currency, issued date. Identity is `sha256("v1|{tenant_hex}|…")`.
- **get-receipt** — fetch one filed record.
- **list-receipts** — ids in the tenant index (cap 256).
- **verify-receipt** — re-hash the claimed fields and compare to the stored digest.

Invoice bodies, emails, names, and bank details never enter the contract. Amounts are canonicalized so `100.10` and `100.1` are the same receipt.

## Host capabilities

`world.wit` imports only:

- `host:tenant/tenant-context@1.0.0`
- `host:interfaces/logging@2.1.0`
- `host:interfaces/kv-store@2.1.0`

No `http`, no `http-with-placeholders`, no `secrets` map. The single map tail is `receipts`. ACLs grant that one `contract_id` read/write.

WIT package/world follow the official shape (`generic-input` → `result<list<u8>, string>`, `export contracts`). Vendored host WIT is copied from Terminal-3 `z-tenant-flight` at `host-interfaces@2.1.0` and `host-tenant@1.0.0`.

## Layout

```
t3n-vendor-receipts/
  contract/     # Rust WASM component (sibling of host, as the ADK docs require)
  host/         # ESM Node app using @terminal3/t3n-sdk + tsx
  README.md
  SUBMISSION.md
  GOOGLE_DOC.md
  BUGS.md
```

`host/` scripts fail closed if `T3N_API_KEY` is missing. They never write a key to disk. Tenant key and agent key are different env vars (`T3N_API_KEY` vs `T3N_AGENT_KEY`).

## Tests

Native `cargo test` covers canonicalize, hash, duplicate-id, reject-bad-amount, verify match/mismatch, using an in-memory store (same functions the WASM guest calls). Host unit tests cover the missing-key guard and the golden hash. WASM build is optional for local review; registration needs `wasm32-wasip2`.

## What this VM cannot do

Sign in at https://go.terminal3.io/adk-community, claim two keys, publish a Google Doc, or submit the Superteam form. Those stay in `SUBMISSION.md`.
