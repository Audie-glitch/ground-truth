#!/usr/bin/env node
/**
 * Refresh ~/.phantom-mcp/auth2-stamper.json without starting a new login.
 * Does not print tokens.
 *
 * Usage: node scripts/refresh-phantom-session.mjs
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
const { Auth2Stamper } = require(auth2Path);

const sessionDir = path.join(os.homedir(), ".phantom-mcp");
const storageFile = path.join(sessionDir, "auth2-stamper.json");
if (!fs.existsSync(storageFile)) {
  console.error(JSON.stringify({ ok: false, error: "No auth2-stamper.json" }));
  process.exit(2);
}

let registeredClientId;
try {
  registeredClientId = JSON.parse(fs.readFileSync(path.join(sessionDir, "agent-registration.json"), "utf-8")).client_id;
} catch {
  registeredClientId = undefined;
}
const clientId = process.env.PHANTOM_CLIENT_ID || process.env.PHANTOM_APP_ID || registeredClientId || "phantom-mcp";

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

const before = JSON.parse(fs.readFileSync(storageFile, "utf-8")).tokenExpiresAt;
const stamper = new Auth2Stamper(new FileStorage(), {
  authApiBaseUrl: "https://auth.phantom.app",
  clientId,
  redirectUri: "",
});
await stamper.init();
const refreshed = await stamper.maybeRefreshTokens();
const after = JSON.parse(fs.readFileSync(storageFile, "utf-8")).tokenExpiresAt;
console.log(
  JSON.stringify({
    ok: true,
    refreshed,
    expiresInSec: after ? Math.round((after - Date.now()) / 1000) : null,
    extended: Boolean(before && after && after > before),
  }),
);
