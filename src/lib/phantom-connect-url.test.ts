import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { connectCodeTtlLeftSec, isAllowedPhantomConnectUrl } from "./phantom-connect-url";

describe("isAllowedPhantomConnectUrl", () => {
  it("allows only https device-connect links on connect.phantom.app", () => {
    expect(
      isAllowedPhantomConnectUrl(
        "https://connect.phantom.app/device-connect?user_code=abc",
      ),
    ).toBe(true);
    expect(isAllowedPhantomConnectUrl("https://evil.example/device-connect")).toBe(false);
    expect(isAllowedPhantomConnectUrl("http://connect.phantom.app/device-connect")).toBe(false);
    expect(isAllowedPhantomConnectUrl("not-a-url")).toBe(false);
  });
});

describe("connectCodeTtlLeftSec", () => {
  it("uses device-file mtime so a rewritten status timestamp cannot fake a fresh code", () => {
    const dir = mkdtempSync(join(tmpdir(), "gt-connect-ttl-"));
    const devicePath = join(dir, "device.json");
    writeFileSync(
      devicePath,
      JSON.stringify({ user_code: "AbCd1234", expires_in: 600 }),
      "utf-8",
    );
    const minted = Date.now() - 400_000;
    utimesSync(devicePath, new Date(minted), new Date(minted));
    const ttl = connectCodeTtlLeftSec(
      {
        stage: "waiting",
        user_code: "AbCd1234",
        t: new Date().toISOString(),
      },
      devicePath,
    );
    expect(ttl).toBeGreaterThan(150);
    expect(ttl).toBeLessThan(220);
  });

  it("is zero when the stage is not waiting", () => {
    expect(connectCodeTtlLeftSec({ stage: "timeout", t: new Date().toISOString() }, "/nope")).toBe(
      0,
    );
  });
});
