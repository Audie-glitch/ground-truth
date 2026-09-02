import { describe, expect, it } from "vitest";

import { encodeBalanceOf, hexToDecimal, isEthAddress } from "./evm-balances";

describe("isEthAddress", () => {
  it("accepts a 20-byte hex address and rejects secrets or short values", () => {
    expect(isEthAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isEthAddress("0xAAAAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isEthAddress("not-an-address")).toBe(false);
    expect(isEthAddress("0xabc")).toBe(false);
    expect(isEthAddress("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      false,
    );
  });
});

describe("encodeBalanceOf", () => {
  it("pads the address into an ERC-20 balanceOf call", () => {
    expect(encodeBalanceOf("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      "0x70a08231000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});

describe("hexToDecimal", () => {
  it("converts wei and USDC base units without floating-point drift", () => {
    expect(hexToDecimal("0x0", 18)).toBe("0");
    expect(hexToDecimal("0xde0b6b3a7640000", 18)).toBe("1");
    expect(hexToDecimal("0x1", 18)).toBe("0.000000000000000001");
    expect(hexToDecimal("0xf4240", 6)).toBe("1");
    expect(hexToDecimal("0x0f4240", 6)).toBe("1");
  });
});
