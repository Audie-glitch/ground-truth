"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";

import { EquityChart } from "@/components/equity-chart";
import { MetricTile } from "@/components/metric-tile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  formatPct,
  formatPctMagnitude,
  formatPlainPct,
  formatUnits,
  formatUsd,
} from "@/lib/format";
import { defaultParams, getStrategy, STRATEGIES } from "@/lib/strategies";
import type { BacktestResult, StrategyId } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AssetOption = { id: string; symbol: string; name: string };

type Props = {
  assets: AssetOption[];
  coinId: string;
  onCoinIdChange: (id: string) => void;
};

const WINDOWS = [
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 180 days" },
  { value: 365, label: "Last 365 days" },
];

export function BacktestLab({ assets, coinId, onCoinIdChange }: Props) {
  const [days, setDays] = useState(365);
  const [strategyId, setStrategyId] = useState<StrategyId>("dip_flip");
  const [params, setParams] = useState<Record<string, number>>(() =>
    defaultParams("dip_flip"),
  );
  const [capital, setCapital] = useState(10_000);
  const [capitalText, setCapitalText] = useState("10000");
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);

  const spec = useMemo(() => getStrategy(strategyId), [strategyId]);

  const selectStrategy = useCallback((id: StrategyId) => {
    setStrategyId(id);
    setParams(defaultParams(id));
  }, []);

  /**
   * Every input that changes the simulation is folded into one key. Loading is
   * derived by comparing the key we last resolved against the current one,
   * which keeps the previous result on screen while a new run is in flight.
   */
  const requestKey = useMemo(
    () =>
      JSON.stringify({
        coinId,
        days,
        strategyId,
        params,
        capital,
        feeBps,
        slippageBps,
      }),
    [coinId, days, strategyId, params, capital, feeBps, slippageBps],
  );

  const [state, setState] = useState<{
    key: string | null;
    result: BacktestResult | null;
    error: string | null;
  }>({ key: null, result: null, error: null });

  const loading = state.key !== requestKey;
  const { result, error } = state;

  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/backtest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              coinId,
              coinLabel: assets.find((a) => a.id === coinId)?.name ?? coinId,
              days,
              strategyId,
              params,
              initialCapital: capital,
              feeBps,
              slippageBps,
            }),
          });
          const json = await res.json();
          if (controller.signal.aborted) return;
          setState(
            res.ok
              ? { key: requestKey, result: json.result as BacktestResult, error: null }
              : {
                  key: requestKey,
                  result: null,
                  error: json.error ?? "Could not run the backtest.",
                },
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          setState({
            key: requestKey,
            result: null,
            error:
              err instanceof Error ? err.message : "Could not run the backtest.",
          });
        }
      })();
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    requestKey,
    assets,
    coinId,
    days,
    strategyId,
    params,
    capital,
    feeBps,
    slippageBps,
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-start">
      <Card className="lg:sticky lg:top-4">
        <CardHeader>
          <CardTitle className="text-sm">Simulation setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Asset" htmlFor="asset">
            <Select value={coinId} onValueChange={onCoinIdChange}>
              <SelectTrigger id="asset" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assets.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Window" htmlFor="window">
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger id="window" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={String(w.value)}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Strategy" htmlFor="strategy">
            <Select
              value={strategyId}
              onValueChange={(v) => selectStrategy(v as StrategyId)}
            >
              <SelectTrigger id="strategy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGIES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {spec.description}
            </p>
          </Field>

          {spec.params.length > 0 ? (
            <div className="space-y-4 border-t border-foreground/10 pt-4">
              {spec.params.map((p) => (
                <div key={p.key} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label className="text-xs" htmlFor={`p-${p.key}`}>
                      {p.label}
                    </Label>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {params[p.key]}
                      {p.suffix ? ` ${p.suffix}` : ""}
                    </span>
                  </div>
                  <Slider
                    id={`p-${p.key}`}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={[params[p.key] ?? p.default]}
                    onValueChange={([v]) =>
                      setParams((prev) => ({ ...prev, [p.key]: v }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">{p.help}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-4 border-t border-foreground/10 pt-4">
            <Field label="Starting capital" htmlFor="capital">
              <Input
                id="capital"
                inputMode="decimal"
                value={capitalText}
                onChange={(e) => {
                  const text = e.target.value;
                  setCapitalText(text);
                  const n = Number(text.replace(/[^0-9.]/g, ""));
                  if (Number.isFinite(n) && n > 0) setCapital(n);
                }}
                onBlur={() => setCapitalText(String(capital))}
              />
            </Field>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs" htmlFor="fee">
                  Fee per trade
                </Label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {(feeBps / 100).toFixed(2)}%
                </span>
              </div>
              <Slider
                id="fee"
                min={0}
                max={100}
                step={1}
                value={[feeBps]}
                onValueChange={([v]) => setFeeBps(v)}
              />
              <p className="text-xs text-muted-foreground">
                0.10% is a common exchange taker fee. Charged on both sides of
                every trade.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs" htmlFor="slip">
                  Slippage
                </Label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {(slippageBps / 100).toFixed(2)}%
                </span>
              </div>
              <Slider
                id="slip"
                min={0}
                max={100}
                step={1}
                value={[slippageBps]}
                onValueChange={([v]) => setSlippageBps(v)}
              />
              <p className="text-xs text-muted-foreground">
                How much worse than the quoted price you actually fill. Thin
                markets are far worse than this.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not run the simulation</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!result && loading ? <ResultSkeleton /> : null}

        {result ? (
          <div className={cn("space-y-4", loading && "opacity-60 transition-opacity")}>
            <Verdict result={result} />
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                  Equity curve
                  {loading ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
                  ) : null}
                  <span className="font-normal text-muted-foreground">
                    {formatDate(result.equityCurve[0].t)} –{" "}
                    {formatDate(
                      result.equityCurve[result.equityCurve.length - 1].t,
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EquityChart
                  data={result.equityCurve}
                  strategyName={result.strategyName}
                />
              </CardContent>
            </Card>
            <MetricsGrid result={result} />
            <TradeLog result={result} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-2 text-xs" htmlFor={htmlFor}>
        {label}
      </Label>
      {children}
    </div>
  );
}

function Verdict({ result }: { result: BacktestResult }) {
  const delta = result.metrics.totalReturn - result.benchmark.totalReturn;
  const beat = delta > 0;
  const feeDrag = result.metrics.feesPaid / result.initialCapital;

  return (
    <Card
      className={cn(
        "ring-1",
        beat ? "ring-emerald-500/30" : "ring-amber-500/30",
      )}
    >
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={beat ? "default" : "secondary"}>
            {beat ? "Beat buy & hold" : "Lost to buy & hold"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {result.coinLabel} · {result.days} days · fees{" "}
            {(result.feeBps / 100).toFixed(2)}% · slippage{" "}
            {(result.slippageBps / 100).toFixed(2)}%
          </span>
        </div>

        <p className="text-pretty text-base leading-relaxed">
          <span className="font-medium">{result.strategyName}</span> turned{" "}
          {formatUsd(result.initialCapital)} into{" "}
          <span
            className={cn(
              "font-mono font-medium",
              result.metrics.totalReturn >= 0
                ? "text-emerald-400"
                : "text-rose-400",
            )}
          >
            {formatUsd(result.metrics.finalEquity)}
          </span>{" "}
          ({formatPct(result.metrics.totalReturn)}). Buying once and holding
          would have produced{" "}
          <span className="font-mono font-medium">
            {formatUsd(result.benchmark.finalEquity)}
          </span>{" "}
          ({formatPct(result.benchmark.totalReturn)}).{" "}
          {beat ? (
            <>
              The strategy came out{" "}
              <span className="font-medium text-emerald-400">
                {formatPctMagnitude(delta)} ahead
              </span>
              , at the cost of {result.metrics.tradeCount} trades and a{" "}
              {formatPct(result.metrics.maxDrawdown)} worst drawdown.
            </>
          ) : (
            <>
              Doing nothing beat it by{" "}
              <span className="font-medium text-amber-400">
                {formatPctMagnitude(delta)}
              </span>
              .
            </>
          )}
        </p>

        {result.metrics.tradeCount > 2 ? (
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            It placed {result.metrics.tradeCount} orders and paid{" "}
            <span className="font-mono">
              {formatUsd(result.metrics.feesPaid)}
            </span>{" "}
            in fees and spread, which is {formatPlainPct(feeDrag, 1)} of the
            starting capital handed to the venue before any profit was made.
            {result.metrics.winRate !== null &&
            result.metrics.winRate > 0.5 &&
            !beat ? (
              <>
                {" "}
                Note that {formatPlainPct(result.metrics.winRate, 0)} of its
                completed trades were winners. A high win rate and a losing
                account are entirely compatible.
              </>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MetricsGrid({ result }: { result: BacktestResult }) {
  const m = result.metrics;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <MetricTile
        label="Total return"
        value={formatPct(m.totalReturn)}
        tone={m.totalReturn >= 0 ? "good" : "bad"}
        sub={`Buy & hold ${formatPct(result.benchmark.totalReturn)}`}
        hint="Change in account value over the window, after fees and slippage."
      />
      <MetricTile
        label="Annualised"
        value={formatPct(m.cagr)}
        tone={m.cagr >= 0 ? "good" : "bad"}
        hint="The compound annual rate this result implies. Extrapolating a short crypto window to a year is optimistic by nature."
      />
      <MetricTile
        label="Max drawdown"
        value={formatPct(m.maxDrawdown)}
        tone={m.maxDrawdown < -0.2 ? "bad" : "neutral"}
        sub={`Buy & hold ${formatPct(result.benchmark.maxDrawdown)}`}
        hint="The deepest peak-to-trough fall in account value. This is the number that decides whether you can actually stay in a strategy."
      />
      <MetricTile
        label="Sharpe"
        value={m.sharpe.toFixed(2)}
        tone={m.sharpe > 1 ? "good" : "neutral"}
        hint="Return per unit of volatility, annualised, assuming a zero risk-free rate. Above 1 is good; below 0 means you were paid nothing for the risk."
      />
      <MetricTile
        label="Volatility"
        value={formatPlainPct(m.volatility, 0)}
        hint="Annualised standard deviation of daily account returns."
      />
      <MetricTile
        label="Orders placed"
        value={String(m.tradeCount)}
        hint="Every buy and every sell. Each one pays a fee and crosses the spread."
      />
      <MetricTile
        label="Fees & spread paid"
        value={formatUsd(m.feesPaid)}
        tone={m.feesPaid > result.initialCapital * 0.05 ? "bad" : "neutral"}
        sub={formatPlainPct(m.feesPaid / result.initialCapital, 1) + " of capital"}
        hint="Total trading costs. This is the one number in the whole simulation that is guaranteed to happen."
      />
      <MetricTile
        label="Win rate"
        value={m.winRate === null ? "—" : formatPlainPct(m.winRate, 0)}
        sub={
          m.winRate === null
            ? "No completed round trips"
            : `${result.roundTrips.length} closed trades`
        }
        hint="Share of completed round trips that made money. A high win rate says nothing about profitability if the losses are larger than the wins."
      />
      <MetricTile
        label="Time in market"
        value={formatPlainPct(m.timeInMarket, 0)}
        hint="Share of days the strategy held the asset. Time out of the market is time you cannot be hurt, and cannot be helped."
      />
    </div>
  );
}

function TradeLog({ result }: { result: BacktestResult }) {
  if (result.fills.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Trade log</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This strategy never found a setup in the selected window, so it
            stayed in cash the whole time.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Trade log
          <span className="ml-2 font-normal text-muted-foreground">
            {result.fills.length} orders
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Fill price</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Units
                </TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Fee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.fills.map((fill, i) => (
                <TableRow key={`${fill.t}-${i}`}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(fill.t)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-medium",
                        fill.side === "buy"
                          ? "text-emerald-400"
                          : "text-rose-400",
                      )}
                    >
                      {fill.side === "buy" ? "Buy" : "Sell"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatUsd(fill.price)}
                  </TableCell>
                  <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                    {formatUnits(fill.units)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatUsd(fill.notional)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {formatUsd(fill.fee)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-[420px] w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
