# Superteam Earn: T3N agent build challenge

Event: https://superteam.fun/earn/listing/t3n-agent-build-challenge
Prize: 290 USDC (100 / 50 / 50 / 30 / 30 / 30)
Deadline: **16 September 2026, 15:59 UTC**
Access: `HUMAN_ONLY` — you submit; I cannot.
POC: https://t.me/wardumb (extra test tokens: DM with your DID, quote Superteam)

## Already built

- TEE contract `z:vendor-receipts@0.1.0` with four exports, KV-only.
- Native tests: 6 passing (`cargo test --lib --target x86_64-unknown-linux-gnu`).
- WASM component builds: `z_vendor_receipts.wasm` (~200 KiB).
- Host scripts against `@terminal3/t3n-sdk@5.7.0`. `npm test` covers the missing-key guard.
- `GOOGLE_DOC.md` ready to paste. `BUGS.md` is the bug list they asked for.
- Official-format WIT (`generic-input`, vendored host `@2.1.0` / tenant `@1.0.0`).

## 1. Accounts (you)

1. Confirm you are 18+ and not in a sanctioned location (Superteam / sponsor rules).
2. Sign in at https://go.terminal3.io/adk-community (SSO). If that page and https://www.terminal3.io/claim-page disagree, use whichever actually issues a key — both are official.
3. Copy the **tenant** developer key (shown once). Export `T3N_API_KEY` in your shell. Do not paste it into chat or a file.
4. Open the claim page a second time. Copy the **agent** key. Export `T3N_AGENT_KEY`. Do not reuse the tenant key.
5. From `t3n-vendor-receipts/host`: `npm install && npm run quickstart`. Copy the printed `did:t3n:…` into the Superteam form as “What is your DID generated from the page?”
6. `npm run register` then `T3N_TENANT_DID=… npm run invoke`. Screenshot the `did:t3n:` line, the register `contract_id`, and `verify-receipt` `{ match: true }`.
7. Optional: `npx t3n agent host-card --file src/agent-card.json --env testnet` after putting the agent DID into the card.

## 2. Public Google Doc (you)

Create a Google Doc set to **Anyone with the link → Viewer**. Paste `GOOGLE_DOC.md`. Attach the screenshots from step 1.6 and a screenshot of `cargo test` / `npm test`. Link this GitHub tree (or a standalone public repo of `t3n-vendor-receipts/`).

## 3. Superteam form

- **Email address:** yours.
- **What is your DID generated from the page?** the `did:t3n:…` from `npm run quickstart`. Never invent it from a wallet address.
- **Would you want to continue running this / pass it to us to run it?**  
  Recommended: *Hand it to Terminal 3 to maintain, unless I later join the startup program. Handover: tenant DID, contract tail `vendor-receipts`, map tail `receipts`, latest numeric `contract_id`, this repo. No third-party API keys.*
- **Google Doc URL:** from step 2.
- **Public GitHub:** this directory, or a standalone repo you publish.
- Bonus: an X post tagging [@terminal3io](https://x.com/terminal3io).

## 4. Claim

If they award it, claim at https://superteam.fun/earn/claim/ with your Superteam profile. Payout wallet is yours. Never share a seed phrase.

## Checklist

- [x] Contract + native tests + WASM build
- [x] Host scripts that fail closed without keys
- [x] Google Doc body + bugs list
- [ ] SSO + two keys + `quickstart` DID (you)
- [ ] `register` + `invoke` screenshots (you)
- [ ] Public Google Doc + Superteam form (you)
- [ ] Optional X post tagging @terminal3io (you)
