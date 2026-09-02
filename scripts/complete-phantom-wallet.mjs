#!/usr/bin/env node
/**
 * Finish Phantom agent-wallet provisioning after device-code tokens exist.
 * Does not start a new login and does not print secrets.
 *
 * Usage: node scripts/complete-phantom-wallet.mjs
 */
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const auth2Path = [
  path.join(os.homedir(), ".local/node_modules/@phantom/auth2/dist/index.js"),
  path.join(process.cwd(), "node_modules/@phantom/auth2/dist/index.js"),
].find((p) => fs.existsSync(p));

if (!auth2Path) {
  console.error(JSON.stringify({ ok: false, error: "Install @phantom/auth2 or @phantom/cli first." }));
  process.exit(2);
}

const { Auth2Stamper, Auth2Token } = require(auth2Path);
const sessionDir = path.join(os.homedir(), ".phantom-mcp");
const storageFile = path.join(sessionDir, "auth2-stamper.json");
const sessionFile = path.join(sessionDir, "session.json");

class FileStorage {
  requiresExtractableKeys = true;
  async open() {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  async load() {
    if (!fs.existsSync(storageFile)) return null;
    const stored = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    const [publicKey, privateKey] = await Promise.all([
      crypto.subtle.importKey(
        "raw",
        Buffer.from(stored.publicKeyRawBase64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      ),
      crypto.subtle.importKey(
        "pkcs8",
        Buffer.from(stored.privateKeyPkcs8Base64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
      ),
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

if (!fs.existsSync(storageFile)) {
  console.error(JSON.stringify({ ok: false, error: "No auth2-stamper.json. Approve phantom login first." }));
  process.exit(2);
}

const stored = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
let registeredClientId;
try {
  registeredClientId = JSON.parse(fs.readFileSync(path.join(sessionDir, "agent-registration.json"), "utf-8")).client_id;
} catch {
  registeredClientId = undefined;
}
const clientId = process.env.PHANTOM_CLIENT_ID || process.env.PHANTOM_APP_ID || registeredClientId;
const stamper = new Auth2Stamper(new FileStorage(), {
  authApiBaseUrl: "https://auth.phantom.app",
  clientId: clientId || "phantom-mcp",
  redirectUri: "",
});
await stamper.init();
if (!stamper.bearerToken) {
  console.error(JSON.stringify({ ok: false, error: "Stamper has no access token." }));
  process.exit(2);
}

const access = stamper.bearerToken.replace(/^\w+\s+/, "");
const auth2Token = Auth2Token.fromAccessToken(access);
const appId = auth2Token.clientId || clientId;
const userinfoRes = await fetch("https://auth.phantom.app/userinfo", {
  headers: { authorization: `Bearer ${access}` },
});
const userinfo = await userinfoRes.json();
const organizationId = userinfo.organization_id || userinfo.org_id;
if (!organizationId) {
  console.error(JSON.stringify({ ok: false, error: "userinfo missing organization_id", status: userinfoRes.status }));
  process.exit(3);
}

const body = JSON.stringify({
  method: "getOrCreateWalletWithTag",
  params: {
    organizationId,
    walletName: "App Wallet",
    tag: appId,
    mnemonicLength: 24,
    accounts: [
      { curve: "ed25519", derivationPath: "m/44'/501'/0'/0'", addressFormat: "solana" },
      { curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", addressFormat: "ethereum" },
    ],
  },
  timestampMs: Date.now(),
});
const stamp = await stamper.stamp({ data: Buffer.from(body, "utf-8") });
const res = await fetch("https://api.phantom.app/v1/wallets/kms/rpc", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${access}`,
    "x-app-id": appId,
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
    "x-phantom-wallet-type": "user-wallet",
  },
  body,
});
const data = await res.json().catch(() => ({}));
if (!res.ok || data.type === "whitelist-disabled" || data.error) {
  console.error(
    JSON.stringify({
      ok: false,
      status: res.status,
      type: data.type || data.message,
      detail: data.detail || data.title,
      originRegion: res.headers.get("x-origin-region"),
    }),
  );
  process.exit(1);
}

const wallet = data.result || data;
const walletId = wallet.walletId || wallet.id;
if (!walletId) {
  console.error(JSON.stringify({ ok: false, error: "KMS response had no walletId", keys: Object.keys(wallet || {}) }));
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
fs.writeFileSync(
  sessionFile,
  JSON.stringify(
    {
      walletId,
      organizationId,
      authUserId: auth2Token.sub || userinfo.sub || "",
      appId,
      authFlow: "device-code",
      createdAt: now,
      updatedAt: now,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(JSON.stringify({ ok: true, walletId, organizationId: "present" }));
