# Phantom agent wallet: login succeeded, KMS still blocked

**Probed:** 2 September 2026, this Cloud Agent VM.  
**Goal relevance:** without a provisioned agent wallet there is no Solana or Ethereum address, no balance, and no legal on-chain acquisition to execute.

This note replaces the earlier “Phantom MCP only times out” finding. Device-code login now works. Wallet creation does not.

## What is true now

| Check | Result | Evidence |
| --- | --- | --- |
| `~/.phantom-mcp/auth2-stamper.json` | Present after user approved device code `PRs7Fxb4` | File exists; access token `exp` ~50 minutes after refresh |
| OAuth userinfo | HTTP 200 | `GET https://auth.phantom.app/userinfo` returns `organization_id` plus `auth2_id_token` |
| Access-token JWT | No `organization_id` / `org_id` | Claims are `aud`, `client_id`, `exp`, `ext`, `iat`, `iss`, `jti`, `nbf`, `scp`, `sub`. `aud` is `urn:phantom:wallet-tag:<dcr-client-id>` |
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

`GET /v1/wallets/whitelist/<uuid>` returns `enabled: true`, `status: PUBLIC` with `createdAt` equal to the request time even for unknown IDs. That response is not the KMS allowlist. `PUT /v1/wallets/whitelist/<uuid>` asks for `x-api-key` (we do not have Phantom’s admin key).

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

1. **A Phantom Portal app ID that KMS accepts**, set as `PHANTOM_APP_ID` / `PHANTOM_CLIENT_ID`, then a **new** device login (the current JWT is bound to the disabled DCR client). Create the app at [phantom.com/portal](https://phantom.com/portal). After login, `scripts/complete-phantom-wallet.mjs` (or `phantom wallet addresses`) should print Solana + Ethereum agent addresses.
2. **Phantom enabling KMS for this DCR client** (or for device-flow DCR in general). Then the existing tokens can finish `getOrCreateWalletWithTag` without another login — until they expire.
3. **A funded wallet the user already controls**, with the user signing locally (MetaMask / Phantom extension). This VM still cannot sign for that wallet. It can only prepare unsigned transactions.

Once an agent Ethereum address exists, funding it from MetaMask is the documented Phantom path ([Agent wallets and your existing accounts](https://docs.phantom.com/phantom-mcp-server/account-types)). Do not send funds to a key generated in this VM.

## Retry command (no secrets in git)

```bash
node scripts/complete-phantom-wallet.mjs
```

Reads `~/.phantom-mcp/auth2-stamper.json`, pulls `organization_id` from userinfo, calls KMS with a browser-like UA, and writes `session.json` only if a `walletId` comes back. It never prints tokens.

## Follow-up: server-assigned DCR client

The CLI’s `registerForDeviceFlow` sends a **self-chosen** `client_id`. A second registration that omitted `client_id` (Hydra assigned `b90d07cd-2585-4ced-af0c-41a2841abb16`) succeeded, and RFC 7592 update set `audience` to `urn:phantom:wallet-tag:<that-id>`.

A **side-session** device login was started so the original tokens are not wiped until this client proves KMS works. Code `LcFtqTwh` expired unused at 20:50 UTC. A replacement code is minted on the same Hydra-assigned client when the previous one dies; approval is still required before KMS can be retested.

## Completion status

No agent address, no balance, no transaction. The goal is not achieved.
