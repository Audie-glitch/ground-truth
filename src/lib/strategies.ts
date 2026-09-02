import { rollingHigh, rsi, sma } from "./indicators";
import type { Candle, StrategyId, StrategySpec } from "./types";

/**
 * Every strategy decides using data available *at* the bar it acts on, and the
 * engine fills at that same bar's close. Indicators are therefore read at index
 * `i` only after they are fully formed, and no rule may reference index > i.
 */

const BUY_HOLD: StrategySpec = {
  id: "buy_hold",
  name: "Buy & hold",
  tagline: "Buy once on day one, then do nothing at all.",
  description:
    "The benchmark every other strategy has to beat. It pays exactly one spread and one fee, and it is never out of the market when the biggest up-days land.",
  family: "benchmark",
  params: [],
  plan: (candles) => ({
    mode: "exposure",
    targets: candles.map(() => 1),
  }),
};

const DCA: StrategySpec = {
  id: "dca",
  name: "Dollar-cost average",
  tagline: "Split the same capital into equal buys on a fixed schedule.",
  description:
    "Deploys the identical starting capital in equal slices every N days rather than all at once. It lowers the odds of buying one terrible day and reduces the emotional pull to time an entry.",
  family: "benchmark",
  params: [
    {
      key: "intervalDays",
      label: "Buy every",
      min: 1,
      max: 30,
      step: 1,
      default: 7,
      suffix: "days",
      help: "How often a slice of capital is deployed.",
    },
    {
      key: "buys",
      label: "Number of buys",
      min: 2,
      max: 52,
      step: 1,
      default: 12,
      suffix: "buys",
      help: "Capital is divided into this many equal purchases.",
    },
  ],
  plan: (candles, p) => {
    const interval = Math.max(1, Math.round(p.intervalDays));
    const buys = Math.max(2, Math.round(p.buys));
    const deploy = candles.map(() => 0);
    const slice = 1 / buys;
    let placed = 0;
    for (let i = 0; i < candles.length && placed < buys; i += interval) {
      deploy[i] = slice;
      placed++;
    }
    // Anything the schedule could not fit inside the window is deployed on the
    // final bar so that all strategies are measured on the same capital base.
    if (placed < buys) {
      deploy[candles.length - 1] += slice * (buys - placed);
    }
    return { mode: "deploy", deploy };
  },
};

const SMA_CROSS: StrategySpec = {
  id: "sma_cross",
  name: "Moving-average crossover",
  tagline: "Hold while the fast average is above the slow one.",
  description:
    "The classic trend-following filter. It sidesteps some long drawdowns, but it always enters late and exits late, and it whipsaws badly in a sideways market.",
  family: "systematic",
  params: [
    {
      key: "fast",
      label: "Fast average",
      min: 2,
      max: 60,
      step: 1,
      default: 10,
      suffix: "days",
      help: "Shorter average. Lower values react faster and trade more.",
    },
    {
      key: "slow",
      label: "Slow average",
      min: 5,
      max: 200,
      step: 1,
      default: 40,
      suffix: "days",
      help: "Longer average defining the prevailing trend.",
    },
  ],
  plan: (candles, p) => {
    const closes = candles.map((c) => c.close);
    const fast = sma(closes, Math.max(2, Math.round(p.fast)));
    const slow = sma(closes, Math.max(3, Math.round(p.slow)));
    const targets = candles.map((_, i) => {
      const f = fast[i];
      const s = slow[i];
      if (f === null || s === null) return 0;
      return f > s ? 1 : 0;
    });
    return { mode: "exposure", targets };
  },
};

const RSI_REVERSION: StrategySpec = {
  id: "rsi_reversion",
  name: "RSI mean reversion",
  tagline: "Buy when it looks oversold, sell when it looks overbought.",
  description:
    "Buying dips works right up until the dip is the start of a real decline, at which point this strategy is fully invested the whole way down.",
  family: "systematic",
  params: [
    {
      key: "period",
      label: "RSI period",
      min: 2,
      max: 40,
      step: 1,
      default: 14,
      suffix: "days",
      help: "Lookback used to compute RSI.",
    },
    {
      key: "buyBelow",
      label: "Buy below RSI",
      min: 5,
      max: 50,
      step: 1,
      default: 30,
      help: "Enter when RSI closes under this level.",
    },
    {
      key: "sellAbove",
      label: "Sell above RSI",
      min: 50,
      max: 95,
      step: 1,
      default: 70,
      help: "Exit when RSI closes over this level.",
    },
  ],
  plan: (candles, p) => {
    const closes = candles.map((c) => c.close);
    const values = rsi(closes, Math.max(2, Math.round(p.period)));
    const targets: number[] = [];
    let held = 0;
    for (let i = 0; i < candles.length; i++) {
      const v = values[i];
      if (v !== null) {
        if (held === 0 && v < p.buyBelow) held = 1;
        else if (held === 1 && v > p.sellAbove) held = 0;
      }
      targets.push(held);
    }
    return { mode: "exposure", targets };
  },
};

const BREAKOUT: StrategySpec = {
  id: "breakout",
  name: "Breakout momentum",
  tagline: "Buy new highs, sell when the trend gives way.",
  description:
    "Enters when price clears its recent range and exits on a trailing stop. It catches the parabolic runs that make crypto famous, and pays for them with a long tail of small losing entries.",
  family: "systematic",
  params: [
    {
      key: "lookback",
      label: "Breakout window",
      min: 3,
      max: 90,
      step: 1,
      default: 20,
      suffix: "days",
      help: "Enter when price closes above the highest close of this window.",
    },
    {
      key: "stopPct",
      label: "Trailing stop",
      min: 2,
      max: 50,
      step: 1,
      default: 15,
      suffix: "%",
      help: "Exit after price falls this far from the peak reached while held.",
    },
  ],
  plan: (candles, p) => {
    const closes = candles.map((c) => c.close);
    const highs = rollingHigh(closes, Math.max(3, Math.round(p.lookback)));
    const stop = Math.max(0.01, p.stopPct / 100);
    const targets: number[] = [];
    let held = 0;
    let peak = 0;
    for (let i = 0; i < candles.length; i++) {
      const price = closes[i];
      const high = highs[i];
      if (held === 1) {
        peak = Math.max(peak, price);
        if (price <= peak * (1 - stop)) held = 0;
      } else if (high !== null && price > high) {
        held = 1;
        peak = price;
      }
      targets.push(held);
    }
    return { mode: "exposure", targets };
  },
};

const DIP_FLIP: StrategySpec = {
  id: "dip_flip",
  name: "Quick-flip scalper",
  tagline: "Buy any dip, take a small profit, repeat forever.",
  description:
    "The shape most 'quick gains' advice actually takes. Each individual trade wins far more often than it loses, which is exactly why the strategy feels good while fees, spread and the occasional un-recovered dip quietly eat the account.",
  family: "reactive",
  params: [
    {
      key: "dipPct",
      label: "Buy the dip at",
      min: 1,
      max: 30,
      step: 1,
      default: 5,
      suffix: "%",
      help: "Enter after price falls this far from its recent peak.",
    },
    {
      key: "takeProfitPct",
      label: "Take profit at",
      min: 1,
      max: 50,
      step: 1,
      default: 5,
      suffix: "%",
      help: "Exit once the position is up this much.",
    },
    {
      key: "stopLossPct",
      label: "Stop loss at",
      min: 2,
      max: 60,
      step: 1,
      default: 20,
      suffix: "%",
      help: "Exit if the position falls this much below entry.",
    },
  ],
  plan: (candles, p) => {
    const dip = Math.max(0.005, p.dipPct / 100);
    const take = Math.max(0.005, p.takeProfitPct / 100);
    const stop = Math.max(0.01, p.stopLossPct / 100);
    const targets: number[] = [];
    let held = 0;
    let peak = candles.length > 0 ? candles[0].close : 0;
    let entry = 0;
    for (let i = 0; i < candles.length; i++) {
      const price = candles[i].close;
      if (held === 0) {
        peak = Math.max(peak, price);
        if (price <= peak * (1 - dip)) {
          held = 1;
          entry = price;
        }
      } else {
        if (price >= entry * (1 + take) || price <= entry * (1 - stop)) {
          held = 0;
          peak = price;
        }
      }
      targets.push(held);
    }
    return { mode: "exposure", targets };
  },
};

export const STRATEGIES: StrategySpec[] = [
  BUY_HOLD,
  DCA,
  SMA_CROSS,
  RSI_REVERSION,
  BREAKOUT,
  DIP_FLIP,
];

export function getStrategy(id: StrategyId): StrategySpec {
  const found = STRATEGIES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown strategy: ${id}`);
  return found;
}

export function defaultParams(id: StrategyId): Record<string, number> {
  return Object.fromEntries(
    getStrategy(id).params.map((p) => [p.key, p.default]),
  );
}

export function isTradeableWindow(candles: Candle[]): boolean {
  return candles.length >= 5;
}
