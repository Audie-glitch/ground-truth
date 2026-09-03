"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";

import { MetricTile } from "@/components/metric-tile";
import type { AssetOption } from "@/components/backtest-lab";
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
  formatStrategyParams,
  formatUsd,
} from "@/lib/format";
import { STRATEGIES } from "@/lib/strategies";
import type { StrategyId, WalkForwardResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  assets: AssetOption[];
  coinId: string;
  onCoinIdChange: (id: string) => void;
};

const WINDOWS = [
  { value: 180, label: "Last 180 days" },
  { value: 365, label: "Last 365 days" },
];

const TRAIN_SPLITS = [
  { value: 0.6, label: "60% train / 40% test" },
  { value: 0.65, label: "65% train / 35% test" },
  { value: 0.7, label: "70% train / 30% test" },
];

export function WalkForwardLab({ assets, coinId, onCoinIdChange }: Props) {
  const [days, setDays] = useState(365);
  const [strategyId, setStrategyId] = useState<StrategyId>("dip_flip");
  const [trainRatio, setTrainRatio] = useState(0.65);
  const [objective, setObjective] = useState<"return" | "sharpe">("return");

  const requestKey = useMemo(
    () => JSON.stringify({ coinId, days, strategyId, trainRatio, objective }),
    [coinId, days, strategyId, trainRatio, objective],
  );

  const [state, setState] = useState<{
    key: string | null;
    result: WalkForwardResult | null;
    error: string | null;
  }>({ key: null, result: null, error: null });

  const loading = state.key !== requestKey;
  const { result, error } = state;

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/walkforward", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            coinId,
            coinLabel: assets.find((a) => a.id === coinId)?.name ?? coinId,
            days,
            strategyId,
            trainRatio,
            objective,
            initialCapital: 10_000,
            feeBps: 10,
            slippageBps: 5,
          }),
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        setState(
          res.ok
            ? { key: requestKey, result: json.result as WalkForwardResult, error: null }
            : {
                key: requestKey,
                result: null,
                error: json.error ?? "Could not run walk-forward test.",
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
              : "Could not run walk-forward test.",
        });
      }
    })();

    return () => controller.abort();
  }, [requestKey, assets, coinId, days, strategyId, trainRatio, objective]);

  const spec = STRATEGIES.find((s) => s.id === strategyId)!;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:items-start">
      <Card className="lg:sticky lg:top-4">
        <CardHeader>
          <CardTitle className="text-sm">Walk-forward setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Field label="Asset" htmlFor="wf-asset">
            <Select value={coinId} onValueChange={onCoinIdChange}>
              <SelectTrigger id="wf-asset" className="w-full">
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

          <Field label="History window" htmlFor="wf-window">
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger id="wf-window" className="w-full">
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

          <Field label="Strategy" htmlFor="wf-strategy">
            <Select
              value={strategyId}
              onValueChange={(v) => setStrategyId(v as StrategyId)}
            >
              <SelectTrigger id="wf-strategy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGIES.filter((s) => s.id !== "buy_hold").map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Train / test split" htmlFor="wf-split">
            <Select
              value={String(trainRatio)}
              onValueChange={(v) => setTrainRatio(Number(v))}
            >
              <SelectTrigger id="wf-split" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRAIN_SPLITS.map((s) => (
                  <SelectItem key={s.value} value={String(s.value)}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Optimize for" htmlFor="wf-objective">
            <Select
              value={objective}
              onValueChange={(v) => setObjective(v as "return" | "sharpe")}
            >
              <SelectTrigger id="wf-objective" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="return">Highest return on train</SelectItem>
                <SelectItem value="sharpe">Highest Sharpe on train</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <p className="border-t border-foreground/10 pt-4 text-xs leading-relaxed text-muted-foreground">
            {spec.description} Parameters are grid-searched on the train window
            only, then frozen and run on the unseen test window. If the train
            result looks great and the test result collapses, the rule was fitted
            to the past.
          </p>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Could not run walk-forward test</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!result && loading ? <Skeleton className="h-96 w-full rounded-xl" /> : null}

        {result ? (
          <div className={cn("space-y-4", loading && "opacity-60 transition-opacity")}>
            <Verdict result={result} loading={loading} />
            <Timeline result={result} />
            <ComparisonTable result={result} />
            <MetricsRow result={result} />
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

function Verdict({ result, loading }: { result: WalkForwardResult; loading: boolean }) {
  const oos = result.testOptimized;
  const oosDefault = result.testDefault;
  const beatHoldOos = oos.totalReturn > oos.benchmarkReturn;
  const beatDefaultOos = oos.totalReturn > oosDefault.totalReturn;
  const severeOverfit = result.overfitGap > 0.15;

  return (
    <Card className={cn(severeOverfit ? "ring-amber-500/30" : "ring-emerald-500/20", "ring-1")}>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={severeOverfit ? "secondary" : beatHoldOos ? "default" : "outline"}>
            {severeOverfit
              ? "Likely overfit"
              : beatHoldOos
                ? "Held up out of sample"
                : "Failed out of sample"}
          </Badge>
          {loading ? (
            <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          <span className="text-xs text-muted-foreground">
            {result.combinationsTried} parameter sets tried on train · optimize for{" "}
            {result.objective === "sharpe" ? "Sharpe" : "return"}
          </span>
        </div>

        <p className="text-pretty leading-relaxed">
          On the train window ({formatDate(result.train.from)} –{" "}
          {formatDate(result.train.to)}), grid search picked{" "}
          <span className="font-mono text-sm">{formatStrategyParams(result.optimizedParams)}</span>{" "}
          and earned{" "}
          <span
            className={cn(
              "font-mono font-medium",
              result.train.totalReturn >= 0 ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {formatPct(result.train.totalReturn)}
          </span>{" "}
          (buy &amp; hold {formatPct(result.train.benchmarkReturn)}). On the
          unseen test window ({formatDate(result.testOptimized.from)} –{" "}
          {formatDate(result.testOptimized.to)}), those same frozen parameters
          returned{" "}
          <span
            className={cn(
              "font-mono font-medium",
              oos.totalReturn >= 0 ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {formatPct(oos.totalReturn)}
          </span>{" "}
          while buy &amp; hold returned {formatPct(oos.benchmarkReturn)} and the
          strategy&apos;s default settings returned{" "}
          {formatPct(oosDefault.totalReturn)}.
        </p>

        {severeOverfit ? (
          <p className="text-pretty text-sm text-muted-foreground">
            The train-to-test gap is {formatPctMagnitude(result.overfitGap)}. That
            is the signature of a rule tuned until it looks good on history rather
            than one that generalises.{" "}
            {!beatDefaultOos
              ? "The optimised params did not even beat the defaults on unseen data."
              : "Optimisation did beat defaults on test, but still check whether the edge is large enough to survive real fees and slippage."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Timeline({ result }: { result: WalkForwardResult }) {
  const trainPct = result.trainRatio * 100;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Train / test split</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex h-3 overflow-hidden rounded-xs">
          <div
            className="bg-chart-1/50"
            style={{ width: `${trainPct}%` }}
            title="Train (parameters chosen here)"
          />
          <div
            className="bg-muted-foreground/30"
            style={{ width: `${100 - trainPct}%` }}
            title="Test (parameters frozen)"
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Train · {result.train.days} days · params chosen here
          </span>
          <span>
            Test · {result.testOptimized.days} days · params frozen
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonTable({ result }: { result: WalkForwardResult }) {
  const rows = [
    {
      label: "Train (optimised params)",
      sub: formatStrategyParams(result.optimizedParams),
      ...result.train,
      benchmark: result.train.benchmarkReturn,
      highlight: "train" as const,
    },
    {
      label: "Test (frozen optimised params)",
      sub: "Same params, unseen dates",
      ...result.testOptimized,
      benchmark: result.testOptimized.benchmarkReturn,
      highlight: "test-opt" as const,
    },
    {
      label: "Test (default params)",
      sub: formatStrategyParams(result.testDefault.params),
      ...result.testDefault,
      benchmark: result.testDefault.benchmarkReturn,
      highlight: "test-def" as const,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">In-sample vs out-of-sample</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Return</TableHead>
              <TableHead className="text-right">Buy &amp; hold</TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                Max DD
              </TableHead>
              <TableHead className="hidden text-right md:table-cell">
                Sharpe
              </TableHead>
              <TableHead className="hidden text-right lg:table-cell">
                Orders
              </TableHead>
              <TableHead className="text-right">Final</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.highlight}
                className={cn(row.highlight === "train" && "bg-chart-1/5")}
              >
                <TableCell>
                  <div className="font-medium">{row.label}</div>
                  <div className="max-w-xs text-xs text-muted-foreground">
                    {row.sub}
                  </div>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono tabular-nums",
                    row.totalReturn >= 0 ? "text-emerald-400" : "text-rose-400",
                  )}
                >
                  {formatPct(row.totalReturn)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatPct(row.benchmark)}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                  {formatPct(row.maxDrawdown)}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                  {row.sharpe.toFixed(2)}
                </TableCell>
                <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground lg:table-cell">
                  {row.tradeCount}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatUsd(row.finalEquity)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MetricsRow({ result }: { result: WalkForwardResult }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricTile
        label="Overfit gap"
        value={formatPctMagnitude(result.overfitGap, 1)}
        tone={result.overfitGap > 0.15 ? "bad" : "neutral"}
        sub="Train return minus test return (optimised)"
        hint="How much of the train-window performance disappeared on unseen data. Large gaps mean the parameters were fitted to noise."
      />
      <MetricTile
        label="OOS vs defaults"
        value={formatPct(
          result.testOptimized.totalReturn - result.testDefault.totalReturn,
        )}
        tone={
          result.testOptimized.totalReturn > result.testDefault.totalReturn
            ? "good"
            : "bad"
        }
        hint="Did grid search actually help on unseen data, or would the default settings have been fine?"
      />
      <MetricTile
        label="OOS vs buy & hold"
        value={formatPct(
          result.testOptimized.totalReturn - result.testOptimized.benchmarkReturn,
        )}
        tone={
          result.testOptimized.totalReturn > result.testOptimized.benchmarkReturn
            ? "good"
            : "bad"
        }
        hint="The only question that matters on unseen data: did the rule beat doing nothing?"
      />
      <MetricTile
        label="Combinations tried"
        value={String(result.combinationsTried)}
        hint="How many parameter sets were evaluated on the train window before picking the winner."
      />
    </div>
  );
}
