import { formatUnits, maxUint160, maxUint256 } from "viem";

export const UNLIMITED_THRESHOLD = 2n ** 255n;

export function isUnlimited(amount: bigint): boolean {
  return amount >= UNLIMITED_THRESHOLD || amount === maxUint160 || amount === maxUint256;
}

export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAmount(amount: bigint, decimals?: number, symbol?: string): string {
  if (isUnlimited(amount)) return "an unlimited amount";
  if (decimals === undefined) return `${amount.toString()} raw units`;
  const n = Number(formatUnits(amount, decimals));
  const text = n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : formatUnits(amount, decimals);
  return symbol ? `${text} ${symbol}` : text;
}

export function formatDeadline(seconds: bigint): { text: string; farFuture: boolean; never: boolean } {
  if (seconds >= 2n ** 47n) return { text: "never expires", farFuture: true, never: true };
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (seconds <= now) return { text: "already expired", farFuture: false, never: false };
  const delta = Number(seconds - now);
  const days = delta / 86_400;
  const farFuture = days > 30;
  if (delta < 3_600) return { text: `${Math.round(delta / 60)} minutes from now`, farFuture, never: false };
  if (days < 2) return { text: `${(delta / 3_600).toFixed(1)} hours from now`, farFuture, never: false };
  if (days < 365) return { text: `${Math.round(days)} days from now`, farFuture, never: false };
  return { text: `${(days / 365).toFixed(1)} years from now`, farFuture, never: false };
}

export function formatEth(wei: bigint): string {
  const n = Number(formatUnits(wei, 18));
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
}
