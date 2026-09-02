import {
  dailyReturns,
  maxDrawdown,
  mean,
  stdev,
} from "./indicators";
import { getStrategy } from "./strategies";
import type {
  BacktestMetrics,
  BacktestResult,
  Candle,
  EquityPoint,
  Fill,
  RoundTrip,
  StrategyId,
  StrategyPlan,
} from "./types";

export type BacktestInput = {
  candles: Candle[];
  strategyId: StrategyId;
  params: Record<string, number>;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  coinId: string;
  coinLabel: string;
};

const MS_PER_DAY = 86_400_000;

type SimOutput = {
  equity: number[];
  exposure: number[];
  fills: Fill[];
  roundTrips: RoundTrip[];
  feesPaid: number;
};

/**
 * Runs one plan over the candle series. Cash and units are tracked explicitly
 * rather than as a return stream so that fees and slippage are charged against
 * real notional the way they would be on an exchange.
 */
function simulate(
  candles: Candle[],
  plan: StrategyPlan,
  initialCapital: number,
  feeBps: number,
  slippageBps: number,
): SimOutput {
  const feeRate = feeBps / 10_000;
  const slipRate = slippageBps / 10_000;

  let cash = initialCapital;
  let units = 0;
  let costBasis = 0;
  let openedAt: number | null = null;

  const equity: number[] = [];
  const exposure: number[] = [];
  const fills: Fill[] = [];
  const roundTrips: RoundTrip[] = [];
  let feesPaid = 0;

  const buy = (t: number, price: number, cashToSpend: number) => {
    const spend = Math.min(cashToSpend, cash);
    if (spend <= 0) return;
    const execPrice = price * (1 + slipRate);
    const notional = spend / (1 + feeRate);
    const fee = notional * feeRate;
    const bought = notional / execPrice;
    if (bought <= 0) return;
    if (units <= 0) openedAt = t;
    cash -= notional + fee;
    units += bought;
    costBasis += notional + fee;
    feesPaid += fee;
    fills.push({ t, side: "buy", price: execPrice, units: bought, notional, fee });
  };

  const sell = (t: number, price: number, unitsToSell: number) => {
    const qty = Math.min(unitsToSell, units);
    if (qty <= 0) return;
    const execPrice = price * (1 - slipRate);
    const proceeds = qty * execPrice;
    const fee = proceeds * feeRate;
    const share = qty / units;
    const releasedCost = costBasis * share;

    cash += proceeds - fee;
    units -= qty;
    costBasis -= releasedCost;
    feesPaid += fee;
    fills.push({ t, side: "sell", price: execPrice, units: qty, notional: proceeds, fee });

    const flat = units <= 1e-12;
    if (flat && openedAt !== null && releasedCost > 0) {
      const net = proceeds - fee;
      roundTrips.push({
        openedAt,
        closedAt: t,
        entry: releasedCost / qty,
        exit: net / qty,
        returnPct: net / releasedCost - 1,
        pnl: net - releasedCost,
      });
      openedAt = null;
      units = 0;
      costBasis = 0;
    }
  };

  let prevTarget: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const { t, close } = candles[i];

    if (plan.mode === "deploy") {
      const fraction = plan.deploy[i] ?? 0;
      if (fraction > 0) buy(t, close, fraction * initialCapital);
    } else {
      const target = clamp01(plan.targets[i] ?? 0);
      if (prevTarget === null || target !== prevTarget) {
        const equityNow = cash + units * close;
        const desired = target * equityNow;
        const current = units * close;
        const diff = desired - current;
        const threshold = Math.max(equityNow * 0.001, 1e-9);
        if (diff > threshold) buy(t, close, diff);
        else if (diff < -threshold) sell(t, close, -diff / close);
      }
      prevTarget = target;
    }

    const equityNow = cash + units * close;
    equity.push(equityNow);
    exposure.push(equityNow > 0 ? (units * close) / equityNow : 0);
  }

  return { equity, exposure, fills, roundTrips, feesPaid };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function computeMetrics(
  equity: number[],
  exposure: number[],
  initialCapital: number,
  spanDays: number,
  fills: Fill[],
  roundTrips: RoundTrip[],
  feesPaid: number,
): BacktestMetrics {
  const finalEquity = equity.length > 0 ? equity[equity.length - 1] : initialCapital;
  const totalReturn = initialCapital > 0 ? finalEquity / initialCapital - 1 : 0;
  const years = spanDays > 0 ? spanDays / 365 : 0;
  const cagr =
    years > 0 && initialCapital > 0 && finalEquity > 0
      ? (finalEquity / initialCapital) ** (1 / years) - 1
      : 0;

  const rets = dailyReturns(equity);
  const dailyVol = stdev(rets);
  const volatility = dailyVol * Math.sqrt(365);
  const sharpe = dailyVol > 0 ? (mean(rets) * 365) / volatility : 0;

  const wins = roundTrips.filter((r) => r.pnl > 0).length;

  return {
    totalReturn,
    cagr,
    maxDrawdown: maxDrawdown(equity),
    volatility,
    sharpe,
    tradeCount: fills.length,
    feesPaid,
    winRate: roundTrips.length > 0 ? wins / roundTrips.length : null,
    timeInMarket:
      exposure.length > 0
        ? exposure.filter((e) => e > 0.001).length / exposure.length
        : 0,
    finalEquity,
  };
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const {
    candles,
    strategyId,
    params,
    initialCapital,
    feeBps,
    slippageBps,
    coinId,
    coinLabel,
  } = input;

  const spec = getStrategy(strategyId);
  const plan = spec.plan(candles, params);
  const sim = simulate(candles, plan, initialCapital, feeBps, slippageBps);

  const holdPlan: StrategyPlan = {
    mode: "exposure",
    targets: candles.map(() => 1),
  };
  const hold = simulate(candles, holdPlan, initialCapital, feeBps, slippageBps);

  const spanDays =
    candles.length > 1
      ? (candles[candles.length - 1].t - candles[0].t) / MS_PER_DAY
      : 0;

  const equityCurve: EquityPoint[] = candles.map((c, i) => ({
    t: c.t,
    equity: sim.equity[i],
    benchmark: hold.equity[i],
    price: c.close,
    exposure: sim.exposure[i],
  }));

  return {
    strategyId,
    strategyName: spec.name,
    params,
    coinId,
    coinLabel,
    days: Math.round(spanDays),
    initialCapital,
    feeBps,
    slippageBps,
    equityCurve,
    fills: sim.fills,
    roundTrips: sim.roundTrips,
    metrics: computeMetrics(
      sim.equity,
      sim.exposure,
      initialCapital,
      spanDays,
      sim.fills,
      sim.roundTrips,
      sim.feesPaid,
    ),
    benchmark: computeMetrics(
      hold.equity,
      hold.exposure,
      initialCapital,
      spanDays,
      hold.fills,
      hold.roundTrips,
      hold.feesPaid,
    ),
  };
}
