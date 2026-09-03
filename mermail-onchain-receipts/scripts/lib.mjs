export const HASH_RE = /0x[a-fA-F0-9]{64}/g;

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const KNOWN_TOKENS = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6, chain: "ethereum" },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6, chain: "base" },
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": { symbol: "USDC", decimals: 6, chain: "sepolia" },
};

export const CHAINS = [
  { name: "ethereum", chainId: 1, rpc: "https://ethereum-rpc.publicnode.com" },
  { name: "base", chainId: 8453, rpc: "https://base-rpc.publicnode.com" },
  { name: "sepolia", chainId: 11155111, rpc: "https://ethereum-sepolia-rpc.publicnode.com" },
  { name: "creditcoin-cc3", chainId: 102031, rpc: "https://rpc.cc3-testnet.creditcoin.network" },
];

export function extractHashes(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text).matchAll(HASH_RE)) {
    const h = m[0].toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
    if (out.length >= 10) break;
  }
  return out;
}

export function topicAddress(topic) {
  if (!topic || typeof topic !== "string" || topic.length < 40) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

export function decodeTransfers(logs) {
  const out = [];
  for (const log of logs || []) {
    const topics = log.topics || [];
    if (!topics[0] || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;
    const from = topicAddress(topics[1]);
    const to = topicAddress(topics[2]);
    if (!from || !to) continue;
    let raw = "0";
    try {
      if (log.data && log.data !== "0x") raw = BigInt(log.data).toString();
    } catch {
      raw = "0";
    }
    const token = String(log.address || "").toLowerCase();
    const known = KNOWN_TOKENS[token];
    out.push({
      token: log.address || null,
      from,
      to,
      value: raw,
      symbol: known?.symbol ?? null,
      decimals: known?.decimals ?? null,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function formatAmount(value, decimals) {
  if (value == null) return null;
  const raw = BigInt(value);
  if (decimals == null) return raw.toString();
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function formatDraftCard({ mailbox, items }) {
  const lines = [
    "On-chain receipt file",
    mailbox ? `Mailbox: ${mailbox}` : null,
    "",
  ].filter((row) => row !== null);
  for (const item of items || []) {
    lines.push(`${item.hash} — ${item.status}${item.chain ? ` on ${item.chain}` : ""}`);
    if (item.blockNumber != null) lines.push(`  block ${item.blockNumber}`);
    if (item.from) lines.push(`  from ${item.from}`);
    if (item.to) lines.push(`  to ${item.to}`);
    if (item.value && item.value !== "0x0" && item.value !== "0") {
      lines.push(`  native value ${item.value}`);
    }
    for (const t of item.transfers || []) {
      const qty = formatAmount(t.value, t.decimals);
      const label = t.symbol ? `${qty} ${t.symbol}` : `${qty} at ${t.token}`;
      lines.push(`  transfer ${label} ${t.from} -> ${t.to}`);
    }
    if (item.sourceMessageId) lines.push(`  source ${item.sourceMessageId}`);
    lines.push("");
  }
  lines.push("Draft only. Not a send. Inbound mail did not authorize a payment.");
  return lines.join("\n");
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || "rpc error");
  return body.result;
}

function decodeHit(chain, receipt, tx) {
  return {
    status: receipt.status === "0x1" ? "confirmed" : receipt.status === "0x0" ? "failed" : "unknown",
    chain: chain.name,
    chainId: chain.chainId,
    rpc: chain.rpc,
    blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : null,
    from: receipt.from || tx?.from || null,
    to: receipt.to || tx?.to || null,
    value: tx?.value ?? receipt.value ?? null,
    transfers: decodeTransfers(receipt.logs),
  };
}

export async function lookupHash(hash, chains = CHAINS) {
  const hits = [];
  for (const chain of chains) {
    try {
      const receipt = await rpc(chain.rpc, "eth_getTransactionReceipt", [hash]);
      if (!receipt) {
        hits.push({ status: "not_found", chain: chain.name, chainId: chain.chainId, rpc: chain.rpc });
        continue;
      }
      let tx = null;
      try {
        tx = await rpc(chain.rpc, "eth_getTransactionByHash", [hash]);
      } catch {
        tx = null;
      }
      hits.push(decodeHit(chain, receipt, tx));
    } catch (err) {
      hits.push({
        status: "rpc_error",
        chain: chain.name,
        chainId: chain.chainId,
        rpc: chain.rpc,
        error: String(err.message || err),
      });
    }
  }
  const found = hits.filter((h) => h.status === "confirmed" || h.status === "failed");
  if (found.length > 1) return { hash, status: "ambiguous", hits: found };
  if (found.length === 1) return { hash, ...found[0] };
  return { hash, status: "not_found", attempts: hits };
}

export async function lookupHashes(hashes) {
  const out = [];
  for (const hash of hashes) out.push(await lookupHash(hash));
  return out;
}
