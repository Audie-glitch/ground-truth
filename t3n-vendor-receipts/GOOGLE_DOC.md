# Vendor Receipts — T3N enterprise agent

**Listing:** https://superteam.fun/earn/listing/t3n-agent-build-challenge  
**Code:** public GitHub — `t3n-vendor-receipts/` in this repository  
**Continue or hand over:** Hand over to Terminal 3 unless we join the startup program. Handover is the tenant DID, contract tail `vendor-receipts`, map tail `receipts`, latest `contract_id`, and this repo. There is no Duffel (or other) API key to rotate.

## What it does

A finance/AP desk files vendor invoices **inside a Terminal 3 TEE**. The contract stores vendor name, invoice id, amount, currency, and issued date. It identifies each invoice by

`sha256("v1|{tenant_hex}|{vendor}|{invoice_id}|{amount}|{currency}|{issued_at}")`

`verify-receipt` re-hashes claimed fields. Invoice PDFs, emails, legal names, and bank details never enter WASM. There is no outbound HTTP.

This is easier to keep running than the official Duffel flight showcase: one KV map (`receipts`), three host imports, no third-party secret, no `allowedHosts` grant.

## How to run

```bash
cd contract && cargo test --lib --target x86_64-unknown-linux-gnu
cd contract && cargo build --target wasm32-wasip2 --release
cd host && npm install && npm test
export T3N_API_KEY=…          # tenant key from the claim page
npm run quickstart            # copy did:t3n:… — do not invent it
export T3N_TENANT_DID=did:t3n:…
npm run register
export T3N_AGENT_KEY=…        # second key from a second claim-page visit
npm run invoke
```

Claim / SSO: https://go.terminal3.io/adk-community and https://www.terminal3.io/claim-page  
Docs: https://docs.terminal3.io/developers/adk/get-started/quickstart

## Screenshots (attach below)

1. `cargo test --lib --target x86_64-unknown-linux-gnu` — 6 passed
2. `npm test` in `host/` — 3 passed
3. `npm run quickstart` — `Connected as: did:t3n:…`
4. `npm run register` — `registered z:<tid>:vendor-receipts as contract id N`
5. `npm run invoke` — `verify-receipt` with `"match": true`

## Bugs found while following the official docs

See `BUGS.md` in the repo. Short list:

- Flight README still documents passenger PII in `book-offer` input; the crate uses `http-with-placeholders` and rejects that payload.
- Flight `.cargo/config.toml` defaults to `wasm32-wasip2`, so the documented `cargo test` fails unless you pass a native `--target`.
- `create-kv-maps` talks only about a `secrets` map. A KV-only contract needs a different tail; `readers` must be set or the governor denies reads.
- Re-registering a tail allocates a new `contract_id` with no lookup API, so map ACLs go stale.
- Tenant key ≠ agent key. Reuse causes `InsufficientCreditError`.
- Listing SSO (`go.terminal3.io/adk-community`) and docs claim page (`terminal3.io/claim-page`) are two URLs for the same step.

## Maintain after the challenge

No HTTP allowlist, no secrets rotation. Bump `CONTRACT_VERSION` on re-register, then `maps.update` the `receipts` ACL to the new `contract_id`. Native tests stay the source of truth for canonicalize/hash.
