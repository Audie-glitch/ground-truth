export interface MemoFactor {
  name: string;
  points: number;
  detail: string;
}

export interface UnderwritingMemo {
  v: number;
  generatedAt?: string;
  score?: number;
  creditLimit?: string;
  policyMax?: string;
  paymentCount?: number;
  factors?: MemoFactor[];
  narrative?: string;
  narrativeSource?: string;
}

const PREFIX = "data:application/json;base64,";

export function decodeMemo(uri: string | undefined | null): UnderwritingMemo | null {
  if (!uri || !uri.startsWith(PREFIX)) return null;
  try {
    const json =
      typeof atob === "function"
        ? decodeURIComponent(
            Array.from(atob(uri.slice(PREFIX.length)))
              .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
              .join(""),
          )
        : Buffer.from(uri.slice(PREFIX.length), "base64").toString("utf8");
    return JSON.parse(json) as UnderwritingMemo;
  } catch {
    return null;
  }
}
