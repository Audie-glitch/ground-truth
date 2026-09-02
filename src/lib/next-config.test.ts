import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("Next.js development origins", () => {
  it("allows the loopback preview host used by Cursor", () => {
    expect(nextConfig.allowedDevOrigins).toContain("127.0.0.1");
  });
});
