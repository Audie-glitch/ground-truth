import type { Candle, CoinSummary } from "./types";

const BASE = "https://api.coingecko.com/api/v3";

/**
 * CoinGecko's keyless tier allows only a handful of calls per minute, and the
 * backtester re-reads the same series as a user tweaks parameters. An in-process
 * cache keeps that interaction fast and keeps us well under the rate limit.
 */
type CacheEntry<T> = { value: T; expires: number };
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) return (await res.json()) as T;
    lastStatus = res.status;

    // 429 is the common failure on the keyless tier; back off and retry.
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      continue;
    }
    break;
  }

  throw new UpstreamError(
    lastStatus === 429
      ? "The market data provider is rate limiting us. Wait a few seconds and try again."
      : `Market data request failed (HTTP ${lastStatus}).`,
    lastStatus || 502,
  );
}

type RawMarket = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  ath_change_percentage: number | null;
};

export async function fetchTopCoins(limit = 25): Promise<CoinSummary[]> {
  return cached(`markets:${limit}`, 60_000, async () => {
    const raw = await getJson<RawMarket[]>(
      `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}` +
        `&page=1&sparkline=false&price_change_percentage=24h%2C7d`,
    );
    return raw
      .filter((c) => typeof c.current_price === "number")
      .map<CoinSummary>((c) => ({
        id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        image: c.image,
        price: c.current_price ?? 0,
        marketCap: c.market_cap ?? 0,
        volume24h: c.total_volume ?? 0,
        change24h: c.price_change_percentage_24h ?? 0,
        change7d: c.price_change_percentage_7d_in_currency ?? null,
        athChangePct: c.ath_change_percentage ?? null,
      }));
  });
}

type RawChart = { prices: [number, number][] };

export async function fetchDailyCandles(
  coinId: string,
  days: number,
): Promise<Candle[]> {
  return cached(`chart:${coinId}:${days}`, 10 * 60_000, async () => {
    const raw = await getJson<RawChart>(
      `/coins/${encodeURIComponent(coinId)}/market_chart` +
        `?vs_currency=usd&days=${days}&interval=daily`,
    );

    // Collapse to one point per UTC day; the provider's final sample is the
    // current partial day and would otherwise duplicate the last close.
    const byDay = new Map<string, Candle>();
    for (const [t, price] of raw.prices) {
      if (!Number.isFinite(price) || price <= 0) continue;
      const key = new Date(t).toISOString().slice(0, 10);
      byDay.set(key, { t, close: price });
    }
    return [...byDay.values()].sort((a, b) => a.t - b.t);
  });
}
