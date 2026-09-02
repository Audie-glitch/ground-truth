#!/usr/bin/env node
/**
 * Print public Solana/Ethereum agent addresses if a Phantom session exists.
 * Never prints tokens, stamps, or private keys.
 *
 * Usage: node scripts/show-agent-addresses.mjs
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

function publicAddresses(wallet) {
  const accounts = []
    .concat(wallet?.accounts || [])
    .concat(wallet?.derivedAccounts || [])
    .concat(wallet?.walletAccounts || []);
  const out = {};
  for (const account of accounts) {
    const address = account?.address || account?.publicAddress;
    if (typeof address !== "string" || !address) continue;
    const kind = String(account.addressFormat || account.addressType || account.curve || "").toLowerCase();
    if (kind.includes("sol") || (!address.startsWith("0x") && address.length >= 32)) out.solana = address;
    if (kind.includes("eth") || kind.includes("secp") || /^0x[0-9a-fA-F]{40}$/.test(address)) {
      out.ethereum = address;
    }
  }
  return out;
}

const sessionDir = path.join(os.homedir(), ".phantom-mcp");
const sessionFile = path.join(sessionDir, "session.json");
const storedAddresses = path.join(sessionDir, "addresses.json");
const statusFile = "/tmp/phantom-dcr2-status.json";

if (fs.existsSync(storedAddresses)) {
  const saved = JSON.parse(fs.readFileSync(storedAddresses, "utf-8"));
  if (saved.ethereum || saved.solana) {
    console.log(JSON.stringify({ ok: true, source: "addresses.json", ...saved }));
    process.exit(0);
  }
}

if (!fs.existsSync(sessionFile)) {
  let connect = null;
  try {
    connect = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  } catch {
    connect = null;
  }
  console.log(
    JSON.stringify({
      ok: false,
      error: "No session.json. Approve Connect or provide PHANTOM_APP_ID.",
      connectStage: connect?.stage || null,
      userCode: connect?.user_code || null,
      url: connect?.url || null,
    }),
  );
  process.exit(2);
}

if (!auth2Path) {
  console.error(JSON.stringify({ ok: false, error: "Install @phantom/auth2 first." }));
  process.exit(2);
}

const { Auth2Stamper, Auth2Token } = require(auth2Path);
const storageFile = path.join(sessionDir, "auth2-stamper.json");
const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));

class FileStorage {
  requiresExtractableKeys = true;
  async open() {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  async load() {
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
  async save() {}
  async clear() {}
}

const stamper = new Auth2Stamper(new FileStorage(), {
  authApiBaseUrl: "https://auth.phantom.app",
  clientId: session.appId || "phantom-mcp",
  redirectUri: "",
});
await stamper.init();
if (!stamper.bearerToken) {
  console.error(JSON.stringify({ ok: false, error: "Stamper has no access token." }));
  process.exit(2);
}
const access = stamper.bearerToken.replace(/^\w+\s+/, "");
const auth2Token = Auth2Token.fromAccessToken(access);
const body = JSON.stringify({
  method: "getWalletWithTag",
  params: {
    organizationId: session.organizationId,
    tag: session.appId,
  },
  timestampMs: Date.now(),
});
const stamp = await stamper.stamp({ data: Buffer.from(body, "utf-8") });
const res = await fetch("https://api.phantom.app/v1/wallets/kms/rpc", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${access}`,
    "x-app-id": session.appId,
    "x-api-version": "2025-11-24",
    "x-auth-user-id": auth2Token.sub,
    "x-phantom-stamp": stamp,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    origin: "https://connect.phantom.app",
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
    }),
  );
  process.exit(1);
}
const wallet = data.result || data;
const addresses = publicAddresses(wallet);
if (addresses.ethereum || addresses.solana) {
  fs.writeFileSync(storedAddresses, JSON.stringify(addresses, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ ok: true, source: "kms", walletId: session.walletId, ...addresses }));
