export function shortAddress(address: string, chars = 4): string {
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Formats a decimal string with thousands separators and at most `maxFraction` decimals. */
export function money(value: string, maxFraction = 2): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: maxFraction });
}

/** Sepolia blocks are ~12s apart; expresses a block distance as a rough duration. */
export function blocksAgo(from: number, to: number | null): string | null {
  if (to === null || from <= 0) return null;
  const seconds = Math.max(0, to - from) * 12;
  if (seconds < 90) return "moments ago";
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)} h ago`;
  return `${(seconds / 86_400).toFixed(1)} days ago`;
}

export function scoreTone(score: number): { label: string; className: string } {
  if (score >= 750) return { label: "Strong", className: "text-emerald-400" };
  if (score >= 600) return { label: "Good", className: "text-lime-400" };
  if (score >= 450) return { label: "Building", className: "text-amber-400" };
  if (score > 0) return { label: "Thin", className: "text-orange-400" };
  return { label: "No score", className: "text-neutral-400" };
}
