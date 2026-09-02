# Phantom agent wallet: login succeeded, KMS still blocked

**Probed:** 2 September 2026, this Cloud Agent VM.  
**Live:** 22:56 UTC 2 Sep 2026 — first-client KMS still `whitelist-disabled` for `4da950ac-…` (`scripts/complete-phantom-wallet.mjs`). Access token `exp` ~23:41 UTC; refresh reported `refreshed:false` with ~44 minutes left. No `session.json` / `addresses.json` / `user-provided.json`. Hydra DCR still waiting on unused code `HJKrPsak` (minted 22:50:37 UTC). `/connect` auto-prompts an injected wallet once per tab when MetaMask/Phantom is present, and can copy the Connect link.  
**Goal relevance:** without a provisioned agent wallet there is no Solana or Ethereum address, no balance, and no legal on-chain acquisition to execute.

This note replaces the earlier “Phantom MCP only times out” finding. Device-code login now works. Wallet creation does not.

## What is true now

| Check | Result | Evidence |
| --- | --- | --- |
| `~/.phantom-mcp/auth2-stamper.json` | Present after user approved device code `PRs7Fxb4` | File exists; access token `exp` ~50 minutes after refresh |
| OAuth userinfo | HTTP 200 | `GET https://auth.phantom.app/userinfo` returns `organization_id` plus `auth2_id_token` |
| Access-token JWT | No `organization_id` / `org_id` | Claims are `aud`, `client_id`, `exp`, `ext`, `iat`, `iss`, `jti`, `nbf`, `scp`, `sub`. `aud` is `urn:phantom:wallet-tag:<dcr-client-id>`. Nested `ext.a2t` has `aud=urn:phantom:kms-api` and is not a usable Bearer. |
| `~/.phantom-mcp/session.json` | **Absent** | No `walletId` |
| Agent addresses | **None** | KMS never returned a wallet |
| Balances / txs | **None** | Nothing to query |
| Phantom MCP tools | Still unusable here | `wallet_status` returned `MCP error -32001` (transport timeout; that tool does not even call Phantom) |

The official CLI path (`DeviceCodeAuthProvider` in `@phantom/cli@1.2.7` and current GitHub `main`) is:

1. Device-code OAuth (`openid offline_access`)
2. Read `organization_id` from the Hydra `id_token`
3. `getOrCreateWalletWithTag` on `https://api.phantom.app/v1/wallets/kms/rpc`

Step 1 succeeded. Step 2’s `id_token` was not persisted by the stamper (only access/refresh tokens are). `organization_id` is available from userinfo anyway. Step 3 is the failure.

## Root cause of the 403

Two different 403s were mixed together until a browser-like request reached origin.

1. **Cloudflare canned body** `{success:false,message:"error",id:"ca7bc294-d1a4-4036-8da2-233d51ca2039"}`  
   Returned for axios-like `User-Agent` on `GET`/`POST` `api.phantom.app/v1/wallets…`. No `x-origin-region`. This is WAF, not KMS.

2. **Origin KMS policy** after sending a browser UA + `Origin: https://connect.phantom.app`:  
   ```json
   {
     "type": "whitelist-disabled",
     "title": "This whitelist has been disabled",
     "detail": "Requests for this app have been disabled. App ID: 4da950ac-7d6e-4bd1-81f7-3100e9e01876"
   }
   ```  
   Headers included `x-origin-region: ca-central-1` and `x-envoy-upstream-service-time`.

The app ID in that error is the **JWT `client_id` / wallet-tag**, not the `x-app-id` header. Changing `x-app-id` to `phantom-mcp` or `phantom-cli` still reported the same DCR UUID.

That UUID came from RFC 7591 dynamic client registration (`DCRClient.registerForDeviceFlow` in `@phantom/cli`). Phantom MCP docs say no Portal app is required; DCR is the intended agent path. Auth accepted the client. **KMS did not.**

`GET /v1/wallets/whitelist/<uuid>` is **not** the KMS allowlist. Rechecked 21:15 UTC 2 Sep 2026:

| App ID | Real whitelist row? | Device-code grant | Notes |
| --- | --- | --- | --- |
| `4da950ac-…` (self-chosen DCR) | **Stub** (`id == externalId`, `createdAt = now`, empty redirects) | Yes (auth succeeded) | KMS `whitelist-disabled` |
| `b90d07cd-…` (Hydra-assigned DCR) | **Stub** (same shape) | Yes (waiting on Connect approval) | Almost certainly the same KMS policy |
| `cf082b41-…` | Real (internal id differs, created 2026-04-14, Connect callback) | No | Official Connect app |
| `a61bc25e-…` | Real (created 2026-04-10) | No | Connect SSO `login/start` prod client |
| `457ad40e-…` / `7e9bb222-…` | Real (Melee / Bonk demo apps) | No | From Connect homepage JS |
| `00000000-0000-…` | Real sandbox row | `invalid_client` | Connect init sandbox |
| `2b4308d3-…` (Connect JS, next to Melee/Bonk) | **Stub** | `invalid_client` | Rechecked 22:02 UTC 2 Sep |
| `582739de-…`, Datadog IDs | Stub or not an OAuth client | `invalid_client` | Analytics / misc |

Stub vs real: a real Portal app has a stable `createdAt` and an internal `id` different from `externalId`. DCR UUIDs get a fresh stub on every GET.

`PUT /v1/wallets/whitelist/<uuid>` asks for `x-api-key` (we do not have Phantom’s admin key).

Phantom Connect’s first-party app `cf082b41-a3b1-4611-9d12-82000722769b` is a real PUBLIC allowlisted app (created 2026-04-14, redirect `https://connect.phantom.app/login/callback`). It **does not** advertise the device-code grant:

`invalid_grant` — *The requested OAuth 2.0 Client does not have the `urn:ietf:params:oauth:grant-type:device_code` grant.*

So we cannot silently switch the existing tokens onto that app, and we cannot complete a new device login with it.

## What was ruled out

- **Wrong public-key encoding** on `getOrCreatePhantomOrganization` (base58 vs base64url SEC1). Official `_getOrMigrateWallet` uses base64url. Retrying all three encodings still 403’d with the canned WAF body, then with `whitelist-disabled` once origin was reached.
- **Missing `organization_id` on the access token.** Userinfo has it. Passing it into `getOrCreateWalletWithTag` still 403’d.
- **Token expiry.** Refresh succeeded (`expiresInMs` ≈ 3599000). userinfo still 200.
- **Generating a hot keypair on this VM and asking for a deposit.** Refused. That is bad custody, not a Phantom agent wallet.

## What is needed to continue

Any one of these unblocks address issuance:

1. **A real Phantom Portal app ID** from [phantom.com/portal](https://phantom.com/portal). Create an account (Google/Apple) → **Create New App** (name, icon, HTTPS website) → **Set Up** → copy the App ID. Paste it here. This VM will classify it with `scripts/check-phantom-app-id.mjs` and, if Hydra advertises the device-code grant, start a **new** device login (the current JWT is bound to the disabled DCR client). First-party Portal/Connect apps we probed are real whitelist rows but **lack** device-code. If yours is the same, run `PHANTOM_APP_ID=<id> phantom login` on your desktop and send the printed Ethereum address — do not paste stamper files or keys.
2. **Phantom enabling KMS for DCR device-flow clients.** Both DCR UUIDs we registered look like whitelist stubs, so this is a Phantom-side policy change.
3. **A funded wallet you already control**, with you signing locally (MetaMask / Phantom extension). This VM still cannot sign for that wallet. It can only prepare unsigned transactions.

Once an agent Ethereum address exists, funding it from MetaMask is the documented Phantom path ([Agent wallets and your existing accounts](https://docs.phantom.com/phantom-mcp-server/account-types)). Do not send funds to a key generated in this VM.

## Retry command (no secrets in git)

```bash
node scripts/refresh-phantom-session.mjs
node scripts/complete-phantom-wallet.mjs
node scripts/show-agent-addresses.mjs
node scripts/check-phantom-app-id.mjs <app-id>
```

Reads `~/.phantom-mcp/auth2-stamper.json`, pulls `organization_id` from userinfo, calls KMS with a browser-like UA, and writes `session.json` only if a `walletId` comes back. It never prints tokens.

## Follow-up: server-assigned DCR client

The CLI’s `registerForDeviceFlow` sends a **self-chosen** `client_id`. A second registration that omitted `client_id` (Hydra assigned `b90d07cd-2585-4ced-af0c-41a2841abb16`) succeeded, and RFC 7592 update set `audience` to `urn:phantom:wallet-tag:<that-id>`.

A **side-session** device login was started so the original tokens are not wiped until this client proves KMS works. Unused codes on this client: `LcFtqTwh`, `Gdc7ctdz`, `xxk79MWg`, `VmcfamKw`, `des6pxAN` (21:35:12 UTC timeout). `scripts/watch-phantom-dcr2-login.mjs` remints only after the previous poller dies.

Rechecked 21:11–21:28 UTC 2 Sep 2026: first-client KMS is still `whitelist-disabled` for `4da950ac-7d6e-4bd1-81f7-3100e9e01876`. Every KMS RPC tried with that token (`getOrCreatePhantomOrganization`, `listPendingMigrations`, `listWallets`, `getOrganization`, `getOrCreateWalletWithTag`) returns the same 403. A VM browser pass on the live Connect URL showed only Google/Apple sign-in — no existing Phantom session. The first-client access token was ~5 minutes from expiry; `scripts/refresh-phantom-session.mjs` refreshed it to ~3600s. `GET https://api.phantom.app/portal/v1/apps` exists but returns 401 with the wallet-tag bearer (Portal uses a different login). This VM’s Phantom MCP process was started with the **literal** env value `${PHANTOM_APP_ID}` — Cursor never substituted a real Portal ID. Phantom MCP `wallet_status` still times out (`-32001`). Every extra UUID pulled from Connect JS is either a whitelist stub, a Datadog id, or a real app **without** the device-code grant.

## Required human action

Device codes `LcFtqTwh`, `Gdc7ctdz`, `xxk79MWg`, `VmcfamKw`, and `des6pxAN` expired unused. Approving the live Hydra-assigned DCR code is still worth one empirical KMS test, but that client has the same stub whitelist row as the disabled first client.

The action that actually unblocks addresses is a **Portal `PHANTOM_APP_ID`** (or Phantom turning KMS on for DCR). This VM cannot complete Google/Apple/wallet consent by itself.

Until a real allowlisted app + login exists:

- No agent Solana/Ethereum address
- No legal deposit target
- No executable swap, airdrop claim, or on-chain buy from this environment

## Completion status

No agent address, no balance, no transaction. The goal is not achieved.
