import fs from "fs";
import path from "path";
import { Auth2Stamper, Auth2Token, decodeJwtClaims } from "/home/ubuntu/.local/node_modules/@phantom/auth2/dist/index.js";

const sessionDir = process.env.PHANTOM_DCR_DIR || "/tmp/phantom-dcr2";
const storageFile = path.join(sessionDir, "auth2-stamper.json");
const statusFile = process.env.PHANTOM_DCR_STATUS || "/tmp/phantom-dcr2-status.json";
const deviceFile = process.env.PHANTOM_DCR_DEVICE || "/tmp/phantom-dcr2-device.json";
const device = JSON.parse(fs.readFileSync(deviceFile, "utf-8"));
const clientId = device.clientId;

function writeStatus(obj) {
  let mintedAt = new Date().toISOString();
  try {
    const prev = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    if (obj.stage === "waiting" && prev.stage === "waiting" && prev.user_code === obj.user_code && prev.t) {
      mintedAt = prev.t;
    }
  } catch {
    /* first write */
  }
  fs.writeFileSync(statusFile, JSON.stringify({ ...obj, t: mintedAt }, null, 2));
  console.log(JSON.stringify(obj));
}

class FileStorage {
  requiresExtractableKeys = true;
  async open() {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  async load() {
    const stored = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    const [publicKey, privateKey] = await Promise.all([
      crypto.subtle.importKey("raw", Buffer.from(stored.publicKeyRawBase64, "base64"), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]),
      crypto.subtle.importKey("pkcs8", Buffer.from(stored.privateKeyPkcs8Base64, "base64"), { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]),
    ]);
    return {
      keyPair: { publicKey, privateKey },
      keyInfo: stored.keyInfo,
      idType: stored.idType,
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      tokenExpiresAt: stored.tokenExpiresAt,
    };
  }
  async save(record) {
    const [publicKeyRaw, privateKeyPkcs8] = await Promise.all([
      crypto.subtle.exportKey("raw", record.keyPair.publicKey),
      crypto.subtle.exportKey("pkcs8", record.keyPair.privateKey),
    ]);
    fs.writeFileSync(
      storageFile,
      JSON.stringify(
        {
          keyInfo: record.keyInfo,
          publicKeyRawBase64: Buffer.from(publicKeyRaw).toString("base64"),
          privateKeyPkcs8Base64: Buffer.from(privateKeyPkcs8).toString("base64"),
          idType: record.idType,
          accessToken: record.accessToken,
          refreshToken: record.refreshToken,
          tokenExpiresAt: record.tokenExpiresAt,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  async clear() {}
}

const stamper = new Auth2Stamper(new FileStorage(), {
  authApiBaseUrl: "https://auth.phantom.app",
  clientId,
  redirectUri: "",
});
await stamper.init();
writeStatus({ ok: true, stage: "waiting", user_code: device.user_code, url: device.url });

const deadline = Date.now() + (device.expires_in || 600) * 1000;
let interval = Math.max(device.interval || 5, 45);
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, interval * 1000));
  const tokenRes = await fetch("https://auth.phantom.app/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
      client_id: clientId,
      resource: `urn:phantom:wallet-tag:${clientId}`,
    }).toString(),
  });
  const tokens = await tokenRes.json();
  if (tokens.error === "authorization_pending") continue;
  if (tokens.error === "slow_down") {
    interval += 5;
    continue;
  }
  if (tokenRes.status === 429 || tokens.error_code === 1015) {
    interval = Math.max(interval + 15, Number(tokens.retry_after) || 60);
    continue;
  }
  if (tokens.error) {
    writeStatus({ ok: false, stage: "token", error: tokens.error, description: tokens.error_description });
    process.exit(1);
  }
  if (!tokens.access_token) {
    writeStatus({ ok: false, stage: "token", error: "no access_token" });
    process.exit(1);
  }
  await stamper.setTokens({
    accessToken: tokens.access_token,
    idType: tokens.token_type || "Bearer",
    refreshToken: tokens.refresh_token,
    expiresInMs: (tokens.expires_in || 3600) * 1000,
  });
  const userinfo = await (
    await fetch("https://auth.phantom.app/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` } })
  ).json();
  let orgId = userinfo.organization_id || userinfo.org_id;
  if (!orgId && tokens.id_token) {
    const claims = decodeJwtClaims(tokens.id_token);
    orgId = claims.organization_id || claims.org_id;
  }
  writeStatus({ ok: true, stage: "tokens", hasOrg: Boolean(orgId) });
  if (!orgId) {
    writeStatus({ ok: false, stage: "org", error: "no organization_id" });
    process.exit(3);
  }
  const auth2Token = Auth2Token.fromAccessToken(tokens.access_token);
  const accounts = [
    { curve: "ed25519", derivationPath: "m/44'/501'/0'/0'", addressFormat: "solana" },
    { curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", addressFormat: "ethereum" },
  ];
  const kmsAttempts = [
    {
      method: "getOrCreateWalletWithTag",
      params: { organizationId: orgId, walletName: "App Wallet", tag: clientId, mnemonicLength: 24, accounts },
    },
    {
      method: "createWallet",
      params: { organizationId: orgId, walletName: "App Wallet", accounts },
    },
    {
      method: "getOrganizationWallets",
      params: { organizationId: orgId, limit: 20, offset: 0 },
    },
  ];

  let kms = {};
  let kmsRes = { ok: false, status: 0 };
  let walletResult = null;
  for (const attempt of kmsAttempts) {
    const body = JSON.stringify({ ...attempt, timestampMs: Date.now() });
    const stamp = await stamper.stamp({ data: Buffer.from(body, "utf-8") });
    kmsRes = await fetch("https://api.phantom.app/v1/wallets/kms/rpc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokens.access_token}`,
        "x-app-id": clientId,
        "x-api-version": "2025-11-24",
        "x-auth-user-id": auth2Token.sub,
        "x-phantom-stamp": stamp,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        origin: "https://connect.phantom.app",
        referer: "https://connect.phantom.app/",
        "x-phantom-sdk-type": "server",
        "x-phantom-sdk-version": "1.2.7",
        "x-phantom-platform": "ext-sdk",
        "x-phantom-client": "mcp",
      },
      body,
    });
    kms = await kmsRes.json().catch(() => ({}));
    const listed = kms.result?.wallets || kms.result?.items;
    walletResult =
      kms.result?.walletId || kms.result?.id
        ? kms.result
        : Array.isArray(listed) && listed[0]
          ? listed[0]
          : null;
    if (kmsRes.ok && walletResult) break;
  }
  if (!kmsRes.ok || kms.type === "whitelist-disabled" || !walletResult) {
    writeStatus({
      ok: false,
      stage: "kms",
      status: kmsRes.status,
      type: kms.type,
      detail: kms.detail,
    });
    process.exit(1);
  }
  const walletId = walletResult.walletId || walletResult.id;
  kms.result = { ...kms.result, ...walletResult };
  const now = Math.floor(Date.now() / 1000);
  const session = {
    walletId,
    organizationId: orgId,
    authUserId: auth2Token.sub || "",
    appId: clientId,
    authFlow: "device-code",
    createdAt: now,
    updatedAt: now,
  };
  const derived = [].concat(kms.result.accounts || []).concat(kms.result.derivedAccounts || []);
  const addresses = {};
  for (const account of derived) {
    const address = account?.address || account?.publicAddress;
    if (typeof address !== "string" || !address) continue;
    const kind = String(account.addressFormat || account.addressType || account.curve || "").toLowerCase();
    if (kind.includes("sol") || (!address.startsWith("0x") && address.length >= 32)) addresses.solana = address;
    if (kind.includes("eth") || kind.includes("secp") || /^0x[0-9a-fA-F]{40}$/.test(address)) {
      addresses.ethereum = address;
    }
  }
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify(session, null, 2), { mode: 0o600 });
  const home = path.join(process.env.HOME, ".phantom-mcp");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.copyFileSync(storageFile, path.join(home, "auth2-stamper.json"));
  fs.writeFileSync(path.join(home, "session.json"), JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(home, "agent-registration.json"), JSON.stringify({ client_id: clientId }, null, 2), { mode: 0o600 });
  if (addresses.ethereum || addresses.solana) {
    fs.writeFileSync(path.join(home, "addresses.json"), JSON.stringify(addresses, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(sessionDir, "addresses.json"), JSON.stringify(addresses, null, 2), { mode: 0o600 });
  }
  writeStatus({ ok: true, stage: "session", walletId, hasEthereum: Boolean(addresses.ethereum) });
  process.exit(0);
}
writeStatus({ ok: false, stage: "timeout" });
process.exit(1);
