import { describe, expect, it } from "vitest";

import { isAllowedPhantomConnectUrl } from "./phantom-connect-url";

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
