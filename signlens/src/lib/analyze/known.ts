import { parseAbi } from "viem";

/** Function ABIs the decoder tries, in order. `approve(address,uint256)` is shared by ERC-20 and ERC-721. */
export const KNOWN_FUNCTIONS = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function decreaseAllowance(address spender, uint256 subtractedValue)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
  "function setApprovalForAll(address operator, bool approved)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  // Permit2
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function lockdown((address token, address spender)[] approvals)",
  // Common proxies / multicalls
  "function multicall(bytes[] data)",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data)",
  "function transferOwnership(address newOwner)",
  "function withdraw(uint256 amount)",
  "function deposit()",
  "function claim()",
  "function mint(uint256 quantity)",
  "function mint(address to, uint256 quantity)",
  "function securityUpdate()",
  "function claimReward()",
  "function safeClaim()",
]);

export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const KNOWN_CONTRACTS: Record<string, string> = {
  [PERMIT2.toLowerCase()]: "Uniswap Permit2",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": "Uniswap Universal Router",
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 SwapRouter",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap V3 SwapRouter02",
  "0x00000000000000adc04c56bf30ac9d3c0aaf14dc": "OpenSea Seaport 1.5",
  "0x0000000000000068f116a894984e2db1123eb395": "OpenSea Seaport 1.6",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch Aggregation Router v5",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x Exchange Proxy",
  "0x000000000000ad05ccc4f10045630fb830b95127": "Blur Marketplace",
};

/** Selector strings that phishing kits reuse to look benign in wallet UIs. */
export const SUSPICIOUS_NAMES = new Set(["securityUpdate", "claimReward", "safeClaim", "claim"]);

/** Well-known ERC-20s so the summary can name the token even when RPC lookups are off. */
export const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; chainId: number }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6, chainId: 1 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6, chainId: 1 },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18, chainId: 1 },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18, chainId: 1 },
  "0x2260fac5e5542a773aa44fbcfb037e7f9d18e7c5": { symbol: "WBTC", decimals: 8, chainId: 1 },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6, chainId: 8453 },
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": { symbol: "USDC", decimals: 6, chainId: 11155111 },
};

export const EXPLORERS: Record<number, { name: string; address: (a: string) => string }> = {
  1: { name: "Etherscan", address: (a) => `https://etherscan.io/address/${a}` },
  11155111: { name: "Sepolia Etherscan", address: (a) => `https://sepolia.etherscan.io/address/${a}` },
  8453: { name: "Basescan", address: (a) => `https://basescan.org/address/${a}` },
  84532: { name: "Base Sepolia", address: (a) => `https://sepolia.basescan.org/address/${a}` },
  42161: { name: "Arbiscan", address: (a) => `https://arbiscan.io/address/${a}` },
  10: { name: "Optimistic Etherscan", address: (a) => `https://optimistic.etherscan.io/address/${a}` },
  137: { name: "Polygonscan", address: (a) => `https://polygonscan.com/address/${a}` },
  56: { name: "BscScan", address: (a) => `https://bscscan.com/address/${a}` },
};
