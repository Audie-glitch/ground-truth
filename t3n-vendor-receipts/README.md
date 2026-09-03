# Vendor Receipts (T3N)

An enterprise TEE contract for Terminal 3: file hashed vendor invoices **inside the tenant KV map**. No outbound HTTP, no Duffel, no `secrets` map, no invoice body or payee PII.

Built for the Superteam [T3N agent build challenge](https://superteam.fun/earn/listing/t3n-agent-build-challenge) ($290 USDC, due **16 Sep 2026 15:59 UTC**). Judges score usefulness and how easy this is to keep running after the challenge.

| Function | Input | Result |
| --- | --- | --- |
| `file-receipt` | vendor, invoice id, amount, currency, issued date | SHA-256 id, `filed` or `exists` |
| `get-receipt` | id | stored record |
| `list-receipts` | (empty) | up to 256 ids |
| `verify-receipt` | id + claimed fields | `{ match: true/false }` |

`100.10` and `100.1` are the same receipt. Identity is

```text
sha256("v1|{tenant_hex}|{vendor}|{invoice_id}|{amount}|{currency}|{issued_at}")
```

WIT imports: `tenant-context`, `logging`, `kv-store` only. Map tail: `receipts`.

## Layout

```text
contract/     Rust WASM component (sibling of host, as the ADK docs require)
host/         ESM Node app — @terminal3/t3n-sdk 5.7.0 + tsx
SUBMISSION.md what only you can do (SSO, two keys, Google Doc, Superteam form)
GOOGLE_DOC.md paste this into a public Google Doc
BUGS.md       issues found in the official docs / reference crate
```

## Prove it without a T3N key

```bash
# Contract — native, no WASM, no network
cd contract
cargo test --lib --target x86_64-unknown-linux-gnu

# Optional: WASM component the register script uploads
rustup target add wasm32-wasip2
cargo build --target wasm32-wasip2 --release
# → target/wasm32-wasip2/release/z_vendor_receipts.wasm (~200 KiB)

# Host — missing-key guard (does not call T3N)
cd ../host
npm install
npm test
```

The host scripts refuse to start if `T3N_API_KEY` / `T3N_AGENT_KEY` are unset. They never write a key to a file.

## Run it on testnet (needs your keys)

1. Sign in at https://go.terminal3.io/adk-community (listing) or https://www.terminal3.io/claim-page (docs). Copy the tenant key. Visit the claim page **again** for a second key — that one is the agent. Balances are separate; reusing the tenant key is the usual `InsufficientCreditError`.
2. Export in the shell only:

```bash
export T3N_API_KEY="0x…"   # tenant
cd host
npm run quickstart         # prints did:t3n:… — copy it, do not invent one
export T3N_TENANT_DID="did:t3n:…"
npm run register           # uploads WASM, creates the receipts map
export T3N_AGENT_KEY="0x…" # the second key
npm run invoke             # file → list → verify
```

3. Publish the agent card after `t3n whoami --env testnet` with the agent key:

```bash
# edit host/src/agent-card.json DID endpoint, then:
npx t3n whoami --env testnet
npx t3n agent host-card --file src/agent-card.json --env testnet
```

This contract has **no outbound HTTP**, so `agent-auth-update` / `allowedHosts` is not required for file/get/list/verify.

## Why not the flight showcase

`z-tenant-flight` needs a Duffel key, an HTTP allowlist grant, and a user profile. Finance teams cannot keep that running without rotating a third-party secret. This vault is one map and four functions. The same Rust functions run in native tests and in the TEE.

## Handover

You can keep running it (Terminal 3 has a startup program) or hand the tenant to them. The handover is: tenant DID, contract tail `vendor-receipts`, map tail `receipts`, latest `contract_id`, and this repo. No third-party API keys to transfer. See `SUBMISSION.md`.
