import { describe, expect, it } from "vitest";

import {
  CREDITPASSPORT_DEPLOYER,
  MIN_CTC_WEI,
  MIN_SEPOLIA_WEI,
  classifyFunding,
  formatEther,
  parseHexWei,
  readDeployerBalances,
} from "./deployer-status";

describe("CreditPassport deployer funding", () => {
  it("exposes the published testnet-only deployer address", () => {
    expect(CREDITPASSPORT_DEPLOYER).toBe(
      "0x8F72A0f832068555C0edAf649b1F8A37d33bA14D",
    );
  });

  it("classifies a zero balance as unfunded", () => {
    expect(classifyFunding(0n, 0n)).toBe("unfunded");
  });

  it("does not treat dust below the deploy gates as ready", () => {
    expect(classifyFunding(MIN_SEPOLIA_WEI - 1n, MIN_CTC_WEI - 1n)).toBe(
      "unfunded",
    );
  });

  it("reports a one-sided Sepolia fund", () => {
    expect(classifyFunding(MIN_SEPOLIA_WEI, 0n)).toBe("sepolia-only");
  });

  it("reports a one-sided Creditcoin fund", () => {
    expect(classifyFunding(0n, MIN_CTC_WEI)).toBe("ctc-only");
  });

  it("is ready only when both gates are met", () => {
    expect(classifyFunding(MIN_SEPOLIA_WEI, MIN_CTC_WEI)).toBe("ready");
    expect(classifyFunding(MIN_SEPOLIA_WEI + 1n, MIN_CTC_WEI + 1n)).toBe(
      "ready",
    );
  });

  it("parses hex wei and formats ether", () => {
    expect(parseHexWei("0x0")).toBe(0n);
    expect(parseHexWei("0x2386f26fc10000")).toBe(MIN_SEPOLIA_WEI);
    expect(formatEther(MIN_SEPOLIA_WEI)).toBe("0.0100");
    expect(() => parseHexWei("nope")).toThrow(/hex integer/i);
  });

  it("reads both chain balances through the supplied RPC client", async () => {
    const seen: string[] = [];
    const rpcFetch = async (url: string) => {
      seen.push(url);
      const result = url.includes("creditcoin") ? "0x2" : "0x1";
      return { json: async () => ({ result }) };
    };
    const balances = await readDeployerBalances(rpcFetch);
    expect(balances).toEqual({ sepoliaWei: 1n, ctcWei: 2n });
    expect(seen).toHaveLength(2);
  });
});
