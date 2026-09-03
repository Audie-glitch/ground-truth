import { encodeFunctionData, maxUint256, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { PERMIT2 } from "./known";
import type { Enricher } from "./types";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const EOA = "0x1111111111111111111111111111111111111111";
const CONTRACT_UNVERIFIED = "0x2222222222222222222222222222222222222222";
const CONTRACT_VERIFIED = "0x3333333333333333333333333333333333333333";
const NFT = "0x4444444444444444444444444444444444444444";
const ME = "0x9999999999999999999999999999999999999999";

/** Deterministic stand-in for on-chain lookups. */
const fakeEnricher: Enricher = {
  async addressInfo(_chainId, address) {
    const a = address.toLowerCase();
    if (a === EOA.toLowerCase() || a === ME.toLowerCase()) return { address, isContract: false, verified: null };
    if (a === CONTRACT_UNVERIFIED.toLowerCase()) return { address, isContract: true, verified: false };
    return { address, isContract: true, verified: true };
  },
  async tokenInfo(_chainId, address) {
    if (address.toLowerCase() === NFT.toLowerCase()) return { address, symbol: "PUNK", standard: "erc721" };
    if (address.toLowerCase() === USDC.toLowerCase()) return { address, symbol: "USDC", decimals: 6, standard: "erc20" };
    return { address, standard: "unknown" };
  },
};

const erc20 = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function setApprovalForAll(address operator, bool approved)",
  "function securityUpdate()",
]);

function rpc(method: string, params: unknown[]) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

describe("transactions", () => {
  it("flags an unlimited approval to a wallet address as critical", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [EOA, maxUint256] });
    const r = await analyze(rpc("eth_sendTransaction", [{ from: ME, to: USDC, data, chainId: "0x1" }]), null, fakeEnricher);
    expect(r.kind).toBe("transaction");
    expect(r.verdict).toBe("critical");
    expect(r.summary).toMatch(/unlimited amount of your USDC/);
    expect(r.findings.map((f) => f.title)).toEqual(expect.arrayContaining(["Unlimited token allowance", "Spender is a plain wallet address, not a contract"]));
    expect(r.token?.symbol).toBe("USDC");
  });

  it("treats a bounded approval to a known contract as low risk", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [PERMIT2, 250_000_000n] });
    const r = await analyze(rpc("eth_sendTransaction", [{ to: USDC, data, chainId: 1 }]), null, fakeEnricher);
    expect(r.verdict).toBe("info");
    expect(r.summary).toMatch(/250 USDC/);
    expect(r.counterparty?.label).toBe("Uniswap Permit2");
  });

  it("flags an unverified spender as high", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [CONTRACT_UNVERIFIED, 1_000_000n] });
    const r = await analyze(rpc("eth_sendTransaction", [{ to: USDC, data, chainId: 1 }]), null, fakeEnricher);
    expect(r.verdict).toBe("high");
  });

  it("recognises revocations", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [CONTRACT_VERIFIED, 0n] });
    const r = await analyze(rpc("eth_sendTransaction", [{ to: USDC, data, chainId: 1 }]), null, fakeEnricher);
    expect(r.findings.some((f) => f.title === "Revocation")).toBe(true);
  });

  it("explains setApprovalForAll and escalates for a wallet operator", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "setApprovalForAll", args: [EOA, true] });
    const r = await analyze(rpc("eth_sendTransaction", [{ to: NFT, data, chainId: 1 }]), null, fakeEnricher);
    expect(r.verdict).toBe("critical");
    expect(r.summary).toMatch(/every PUNK token/);
  });

  it("reads ERC-721 approve as a single-token approval", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [CONTRACT_VERIFIED, 7n] });
    const r = await analyze(rpc("eth_sendTransaction", [{ to: NFT, data, chainId: 1 }]), null, fakeEnricher);
    expect(r.summary).toMatch(/NFT #7/);
    expect(r.verdict).toBe("medium");
  });

  it("describes a token transfer plainly", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [CONTRACT_VERIFIED, 12_500_000n] });
    const r = await analyze(rpc("eth_sendTransaction", [{ to: USDC, data, chainId: 1 }]), null, fakeEnricher);
    expect(r.summary).toMatch(/Sends 12\.5 USDC/);
    expect(r.verdict).toBe("info");
  });

  it("flags securityUpdate() with ETH attached", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "securityUpdate" });
    const r = await analyze(rpc("eth_sendTransaction", [{ to: CONTRACT_UNVERIFIED, data, value: "0xde0b6b3a7640000", chainId: 1 }]), null, fakeEnricher);
    expect(r.verdict).toBe("high");
    expect(r.findings[0]?.title).toBe("Reassuring name, ETH attached");
  });

  it("handles native transfers and empty calls", async () => {
    const r = await analyze(rpc("eth_sendTransaction", [{ to: EOA, value: "0x2386f26fc10000", chainId: 1 }]), null, fakeEnricher);
    expect(r.summary).toMatch(/Sends 0\.01 ETH/);
    const empty = await analyze(JSON.stringify({ to: EOA, chainId: 1 }), null, fakeEnricher);
    expect(empty.summary).toMatch(/Does nothing/);
  });

  it("reports unknown selectors with the target's status", async () => {
    const r = await analyze(rpc("eth_sendTransaction", [{ to: CONTRACT_UNVERIFIED, data: "0xdeadbeef0000", chainId: 1 }]), null, fakeEnricher);
    expect(r.findings.map((f) => f.title)).toEqual(expect.arrayContaining(["Unknown function", "Target is an unverified contract"]));
  });

  it("analyses wallet_sendCalls batches call by call", async () => {
    const approve = encodeFunctionData({ abi: erc20, functionName: "approve", args: [EOA, maxUint256] });
    const r = await analyze(
      rpc("wallet_sendCalls", [{ version: "1.0", chainId: "0x1", calls: [{ to: USDC, data: approve }, { to: EOA, value: "0x1" }] }]),
      null,
      fakeEnricher,
    );
    expect(r.kind).toBe("batch");
    expect(r.children?.length).toBe(2);
    expect(r.verdict).toBe("critical");
  });

  it("accepts raw calldata with a chain hint", async () => {
    const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [EOA, maxUint256] });
    const r = await analyze(data, 1, fakeEnricher);
    expect(r.kind).toBe("transaction");
    expect(r.decoded.some((d) => d.name === "function" && d.value === "approve")).toBe(true);
  });
});

describe("typed data", () => {
  const domain = { name: "USD Coin", version: "2", chainId: 1, verifyingContract: USDC };
  const permitTypes = {
    EIP712Domain: [{ name: "name", type: "string" }],
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  it("explains an EIP-2612 permit and escalates for unlimited + wallet spender", async () => {
    const td = { types: permitTypes, primaryType: "Permit", domain, message: { owner: ME, spender: EOA, value: maxUint256.toString(), nonce: 0, deadline: "115792089237316195423570985008687907853269984665640564039457584007913129639935" } };
    const r = await analyze(rpc("eth_signTypedData_v4", [ME, JSON.stringify(td)]), null, fakeEnricher);
    expect(r.kind).toBe("typed-data");
    expect(r.verdict).toBe("critical");
    expect(r.summary).toMatch(/gasless approval/);
    expect(r.findings.map((f) => f.title)).toEqual(expect.arrayContaining(["Unlimited permit", "The permit never expires"]));
  });

  it("explains Permit2 PermitSingle and checks the domain", async () => {
    const td = {
      types: { PermitSingle: [], PermitDetails: [] },
      primaryType: "PermitSingle",
      domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 },
      message: { details: { token: USDC, amount: "1461501637330902918203684832716283019655932542975", expiration: "1893456000", nonce: 0 }, spender: CONTRACT_VERIFIED, sigDeadline: "1893456000" },
    };
    const r = await analyze(JSON.stringify(td), null, fakeEnricher);
    expect(r.summary).toMatch(/Permit2 approval/);
    expect(r.findings.some((f) => f.title === "Unlimited Permit2 allowance")).toBe(true);
    expect(r.findings.some((f) => f.title.startsWith("Permit2-shaped"))).toBe(false);
  });

  it("flags Permit2-shaped data from a non-Permit2 contract", async () => {
    const td = {
      types: { PermitSingle: [] },
      primaryType: "PermitSingle",
      domain: { name: "Permit2", chainId: 1, verifyingContract: CONTRACT_UNVERIFIED },
      message: { details: { token: USDC, amount: "1000000", expiration: "1893456000", nonce: 0 }, spender: EOA, sigDeadline: "1893456000" },
    };
    const r = await analyze(JSON.stringify(td), null, fakeEnricher);
    expect(r.verdict).toBe("critical");
    expect(r.findings.some((f) => f.title.startsWith("Permit2-shaped"))).toBe(true);
  });

  it("treats PermitTransferFrom as a high-risk pull authorisation", async () => {
    const td = {
      types: { PermitTransferFrom: [] },
      primaryType: "PermitTransferFrom",
      domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 },
      message: { permitted: { token: USDC, amount: "5000000000" }, spender: CONTRACT_VERIFIED, nonce: 1, deadline: "1893456000" },
    };
    const r = await analyze(JSON.stringify(td), null, fakeEnricher);
    expect(r.verdict).toBe("high");
    expect(r.summary).toMatch(/pull 5,000 USDC/);
  });

  it("calls out a zero-consideration Seaport order", async () => {
    const td = {
      types: { OrderComponents: [] },
      primaryType: "OrderComponents",
      domain: { name: "Seaport", version: "1.6", chainId: 1, verifyingContract: "0x0000000000000068F116a894984e2DB1123eB395" },
      message: { offerer: ME, offer: [{ itemType: 2, token: NFT, identifierOrCriteria: "7", startAmount: "1", endAmount: "1" }], consideration: [] },
    };
    const r = await analyze(JSON.stringify(td), null, fakeEnricher);
    expect(r.verdict).toBe("critical");
    expect(r.findings[0]?.title).toBe("You receive nothing");
  });

  it("surfaces spender-like fields in unknown message types", async () => {
    const td = { types: { Delegate: [] }, primaryType: "Delegate", domain: { name: "Thing", chainId: 1 }, message: { delegate: EOA, expiry: 1 } };
    const r = await analyze(JSON.stringify(td), null, fakeEnricher);
    expect(r.verdict).toBe("critical");
    expect(r.findings.some((f) => f.title.startsWith("Message grants something"))).toBe(true);
  });
});

describe("plain signatures", () => {
  it("recognises Sign-In with Ethereum", async () => {
    const msg = `app.example.com wants you to sign in with your Ethereum account:\n${ME}\n\nWelcome\n\nURI: https://app.example.com/login\nVersion: 1\nChain ID: 1\nNonce: abc12345\nIssued At: 2026-09-01T00:00:00Z`;
    const hex = `0x${Buffer.from(msg, "utf8").toString("hex")}`;
    const r = await analyze(rpc("personal_sign", [hex, ME]), null, fakeEnricher);
    expect(r.verdict).toBe("info");
    expect(r.summary).toMatch(/Signs in to app.example.com/);
  });

  it("flags SIWE domain and URI mismatch", async () => {
    const msg = `app.example.com wants you to sign in with your Ethereum account:\n${ME}\n\n\nURI: https://evil.example.net/login\nVersion: 1\nChain ID: 1\nNonce: abc12345\nIssued At: 2026-09-01T00:00:00Z`;
    const r = await analyze(rpc("personal_sign", [msg, ME]), null, fakeEnricher);
    expect(r.verdict).toBe("medium");
  });

  it("flags a hash-shaped personal_sign payload", async () => {
    const r = await analyze(rpc("personal_sign", [`0x${"ab".repeat(32)}`, ME]), null, fakeEnricher);
    expect(r.verdict).toBe("high");
  });

  it("treats eth_sign as critical", async () => {
    const r = await analyze(rpc("eth_sign", [ME, `0x${"cd".repeat(32)}`]), null, fakeEnricher);
    expect(r.kind).toBe("eth-sign");
    expect(r.verdict).toBe("critical");
  });

  it("rejects garbage with a clear message", async () => {
    await expect(analyze("hello", null, fakeEnricher)).rejects.toThrow(/neither hex calldata nor JSON/);
  });
});
