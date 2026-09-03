"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AssetOption } from "@/components/backtest-lab";
import { MetricTile } from "@/components/metric-tile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatPct,
  formatPlainPct,
} from "@/lib/format";
import { defaultParams, STRATEGIES } from "@/lib/strategies";
import type { MonteCarloResult, StrategyId } from "@/lib/types";
import { cn } from "@/lib/utils";

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

export function MonteCarloLab({ assets, coinId, onCoinIdChange }: Props) {
  const [days, setDays] = useState(365);
  const [strategyId, setStrategyId] = useState<StrategyId>("dip_flip");

  const requestKey = useMemo(
    () => JSON.stringify({ coinId, days, strategyId }),
    [coinId, days, strategyId],
  );

  const [state, setState] = useState<{
    key: string | null;
    result: MonteCarloResult | null;
    error: string | null;
  }>({ key: null, result: null, error: null });

  const loading = state.key !== requestKey;
  const { result, error } = state;

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/montecarlo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            coinId,
            coinLabel: assets.find((a) => a.id === coinId)?.name ?? coinId,
            days,
            strategyId,
            params: defaultParams(strategyId),
            initialCapital: 10_000,
            feeBps: 10,
            slippageBps: 5,
            simulations: 800,
          }),
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        setState(
          res.ok
            ? { key: requestKey, result: json.result as MonteCarloResult, error: null }
            : {
                key: requestKey,
                result: null,
                error: json.error ?? "Could not run Monte Carlo simulation.",
              },
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          key: requestKey,
          result: null,
          error:
            err instanceof Error
              ? err.message
              : "Could not run Monte Carlo simulation.",
        });
      }
    })();

    return () => controller.abort();
  }, [requestKey, assets, coinId, days, strategyId]);

  const spec = STRATEGIES.find((s) => s.id === strategyId)!;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:items-start">
      <Card className="lg:sticky lg:top-4">
        <CardHeader>
          <CardTitle className="text-sm">Monte Carlo setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Field label="Asset" htmlFor="mc-asset">
            <Select value={coinId} onValueChange={onCoinIdChange}>
              <SelectTrigger id="mc-asset" className="w-full">
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

          <Field label="Window" htmlFor="mc-window">
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger id="mc-window" className="w-full">
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

          <Field label="Strategy" htmlFor="mc-strategy">
            <Select
              value={strategyId}
              onValueChange={(v) => setStrategyId(v as StrategyId)}
            >
              <SelectTrigger id="mc-strategy" className="w-full">
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
          </Field>

          <p className="border-t border-foreground/10 pt-4 text-xs leading-relaxed text-muted-foreground">
            {spec.description} This tab shuffles the strategy&apos;s daily
            account returns {result?.simulations ?? 800} times while keeping the
            same set of moves. It breaks serial dependence and shows how much of
            the observed result could have come from luck in the ordering of
            those moves.
          </p>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not run Monte Carlo simulation</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!result && loading ? <Skeleton className="h-96 w-full rounded-xl" /> : null}

        {result ? (
          <div className={cn("space-y-4", loading && "opacity-60 transition-opacity")}>
            <Verdict result={result} loading={loading} />
            <DistributionChart result={result} />
            <PercentileGrid result={result} />
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

function Verdict({ result, loading }: { result: MonteCarloResult; loading: boolean }) {
  const actual = result.actual.strategyReturn;
  const median = result.strategy.p50;
  const lucky = actual > result.strategy.p75;
  const unlucky = actual < result.strategy.p25;

  return (
    <Card className="ring-1 ring-foreground/10">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={lucky ? "secondary" : unlucky ? "outline" : "default"}>
            {lucky
              ? "Actual path was lucky"
              : unlucky
                ? "Actual path was unlucky"
                : "Actual path near median"}
          </Badge>
          {loading ? (
            <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          <span className="text-xs text-muted-foreground">
            {result.simulations} shuffled paths · default params
          </span>
        </div>
        <p className="text-pretty leading-relaxed">
          The actual {result.strategyName} path returned{" "}
          <span
            className={cn(
              "font-mono font-medium",
              actual >= 0 ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {formatPct(actual)}
          </span>
          . Shuffling the same daily moves produced a median of{" "}
          <span className="font-mono font-medium">{formatPct(median)}</span>{" "}
          (5th–95th: {formatPct(result.strategy.p5)} to{" "}
          {formatPct(result.strategy.p95)}). In{" "}
          {formatPlainPct(result.probBeatBenchmark, 0)} of shuffled paths the
          strategy beat buy &amp; hold on return ordering alone.
        </p>
      </CardContent>
    </Card>
  );
}

function DistributionChart({ result }: { result: MonteCarloResult }) {
  const chartData = result.strategy.histogram.map((b) => ({
    label: `${(b.binStart * 100).toFixed(0)}%`,
    count: b.count,
    mid: (b.binStart + b.binEnd) / 2,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Return distribution
          <span className="ml-2 font-normal text-muted-foreground">
            shuffled daily moves
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} className="stroke-foreground/10" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                className="text-[10px] fill-muted-foreground"
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                className="text-[11px] fill-muted-foreground"
                width={36}
              />
              <Tooltip
                formatter={(value) => [`${value ?? 0} paths`, "Count"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { mid?: number } | undefined;
                  return row?.mid !== undefined
                    ? `Return ~ ${formatPct(row.mid)}`
                    : "";
                }}
              />
              <ReferenceLine
                x={
                  chartData.reduce((best, row) =>
                    Math.abs(row.mid - result.actual.strategyReturn) <
                    Math.abs(best.mid - result.actual.strategyReturn)
                      ? row
                      : best,
                  ).label
                }
                className="stroke-chart-1"
                strokeWidth={2}
              />
              <Bar dataKey="count" className="fill-chart-1/60" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Vertical marker: bin nearest the actual historical return (
          {formatPct(result.actual.strategyReturn)}).
        </p>
      </CardContent>
    </Card>
  );
}

function PercentileGrid({ result }: { result: MonteCarloResult }) {
  const s = result.strategy;
  const b = result.benchmark;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <MetricTile
        label="Actual return"
        value={formatPct(result.actual.strategyReturn)}
        tone={result.actual.strategyReturn >= 0 ? "good" : "bad"}
        sub={`Hold ${formatPct(result.actual.benchmarkReturn)}`}
        hint="The one path that actually happened."
      />
      <MetricTile
        label="Median shuffle"
        value={formatPct(s.p50)}
        hint="Middle outcome when daily returns are reordered at random."
      />
      <MetricTile
        label="5th percentile"
        value={formatPct(s.p5)}
        tone="bad"
        hint="Bad luck scenario: only 5% of shuffles did worse."
      />
      <MetricTile
        label="95th percentile"
        value={formatPct(s.p95)}
        tone="good"
        hint="Good luck scenario: only 5% of shuffles did better."
      />
      <MetricTile
        label="P(profit)"
        value={formatPlainPct(s.probPositive, 0)}
        hint="Share of shuffled paths that finished positive."
      />
      <MetricTile
        label="P(beat hold)"
        value={formatPlainPct(result.probBeatBenchmark, 0)}
        hint="Share of shuffles where strategy return exceeded benchmark return."
      />
      <MetricTile
        label="Benchmark median"
        value={formatPct(b.p50)}
        sub={`Actual ${formatPct(result.actual.benchmarkReturn)}`}
        hint="Same shuffle test applied to buy-and-hold daily returns."
      />
    </div>
  );
}
