const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ME = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const DRAINER = "0x000000000000000000000000000000000000dEaD";
const MAX = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

export interface Example {
  id: string;
  label: string;
  tone: "bad" | "good" | "neutral";
  chainId: number | null;
  payload: string;
}

const pad = (addr: string) => addr.toLowerCase().replace("0x", "").padStart(64, "0");

export const EXAMPLES: Example[] = [
  {
    id: "drainer-approve",
    label: "Unlimited USDC approval to a wallet",
    tone: "bad",
    chainId: null,
    payload: JSON.stringify(
      {
        method: "eth_sendTransaction",
        params: [{ from: ME, to: USDC, data: `0x095ea7b3${pad(DRAINER)}${MAX}`, value: "0x0", chainId: "0x1" }],
      },
      null,
      2,
    ),
  },
  {
    id: "permit2-drain",
    label: "Permit2 signature for an unknown spender",
    tone: "bad",
    chainId: null,
    payload: JSON.stringify(
      {
        method: "eth_signTypedData_v4",
        params: [
          ME,
          {
            types: {
              PermitBatch: [
                { name: "details", type: "PermitDetails[]" },
                { name: "spender", type: "address" },
                { name: "sigDeadline", type: "uint256" },
              ],
              PermitDetails: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint160" },
                { name: "expiration", type: "uint48" },
                { name: "nonce", type: "uint48" },
              ],
            },
            primaryType: "PermitBatch",
            domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 },
            message: {
              details: [
                { token: USDC, amount: "1461501637330902918203684832716283019655932542975", expiration: "281474976710655", nonce: 0 },
                { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", amount: "1461501637330902918203684832716283019655932542975", expiration: "281474976710655", nonce: 0 },
              ],
              spender: DRAINER,
              sigDeadline: "281474976710655",
            },
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: "set-approval-for-all",
    label: "setApprovalForAll on an NFT collection",
    tone: "bad",
    chainId: null,
    payload: JSON.stringify(
      {
        method: "eth_sendTransaction",
        params: [{ from: ME, to: BAYC, data: `0xa22cb465${pad(DRAINER)}${"1".padStart(64, "0")}`, chainId: "0x1" }],
      },
      null,
      2,
    ),
  },
  {
    id: "zero-price-listing",
    label: "Seaport listing that pays you nothing",
    tone: "bad",
    chainId: null,
    payload: JSON.stringify(
      {
        method: "eth_signTypedData_v4",
        params: [
          ME,
          {
            types: { OrderComponents: [] },
            primaryType: "OrderComponents",
            domain: { name: "Seaport", version: "1.6", chainId: 1, verifyingContract: "0x0000000000000068F116a894984e2DB1123eB395" },
            message: {
              offerer: ME,
              offer: [{ itemType: 2, token: BAYC, identifierOrCriteria: "1234", startAmount: "1", endAmount: "1" }],
              consideration: [],
              startTime: "0",
              endTime: "281474976710655",
            },
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: "eth-sign",
    label: "eth_sign of a raw hash",
    tone: "bad",
    chainId: null,
    payload: JSON.stringify({ method: "eth_sign", params: [ME, `0x${"6a".repeat(32)}`] }, null, 2),
  },
  {
    id: "swap-approve",
    label: "Bounded approval to Permit2 for a swap",
    tone: "good",
    chainId: null,
    payload: JSON.stringify(
      {
        method: "eth_sendTransaction",
        params: [{ from: ME, to: USDC, data: `0x095ea7b3${pad(PERMIT2)}${(250_000_000).toString(16).padStart(64, "0")}`, chainId: "0x1" }],
      },
      null,
      2,
    ),
  },
  {
    id: "siwe",
    label: "Sign-In with Ethereum",
    tone: "good",
    chainId: null,
    payload: JSON.stringify(
      {
        method: "personal_sign",
        params: [
          `app.uniswap.org wants you to sign in with your Ethereum account:\n${ME}\n\nSign in to Uniswap.\n\nURI: https://app.uniswap.org\nVersion: 1\nChain ID: 1\nNonce: 32891756\nIssued At: 2026-09-02T22:00:00.000Z`,
          ME,
        ],
      },
      null,
      2,
    ),
  },
];
