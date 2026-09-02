export function formatUsd(value: number, maxFractionDigits?: number): string {
  const abs = Math.abs(value);
  // Sub-cent precision matters for asset prices and per-trade fees, but zero
  // should read as plain money rather than "$0.000000".
  const digits =
    maxFractionDigits ??
    (abs === 0 ? 2 : abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCompactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPct(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

/** Size of a gap, for prose that already says which side is ahead. */
export function formatPctMagnitude(value: number, digits = 1): string {
  return `${(Math.abs(value) * 100).toFixed(digits)}%`;
}

/** For values already expressed in percentage points, such as API deltas. */
export function formatPctPoints(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatPlainPct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatUnits(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

export function formatDate(t: number): string {
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(t: number): string {
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
