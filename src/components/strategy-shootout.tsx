"use client";

import { useEffect, useState } from "react";
import { AlertCircleIcon, TrophyIcon } from "lucide-react";

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
import { formatDate, formatPct, formatPlainPct, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  strategyId: string;
  name: string;
  tagline: string;
  family: string;
  totalReturn: number;
  maxDrawdown: number;
  sharpe: number;
  tradeCount: number;
  feesPaid: number;
  winRate: number | null;
  timeInMarket: number;
  finalEquity: number;
};

type Response = {
  rows: Row[];
  initialCapital: number;
  days: number;
  from: number;
  to: number;
};

const WINDOWS = [90, 180, 365];
const CAPITAL = 10_000;

type Props = {
  assets: AssetOption[];
  coinId: string;
  onCoinIdChange: (id: string) => void;
};

export function StrategyShootout({ assets, coinId, onCoinIdChange }: Props) {
  const [days, setDays] = useState(365);
  const requestKey = `${coinId}|${days}`;

  const [state, setState] = useState<{
    key: string | null;
    data: Response | null;
    error: string | null;
  }>({ key: null, data: null, error: null });

  const loading = state.key !== requestKey;
  const { data, error } = state;

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/compare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            coinId,
            days,
            initialCapital: CAPITAL,
            feeBps: 10,
            slippageBps: 5,
          }),
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        setState(
          res.ok
            ? { key: requestKey, data: json as Response, error: null }
            : {
                key: requestKey,
                data: null,
                error: json.error ?? "Could not run the comparison.",
              },
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          key: requestKey,
          data: null,
          error:
            err instanceof Error
              ? err.message
              : "Could not run the comparison.",
        });
      }
    })();

    return () => controller.abort();
  }, [requestKey, coinId, days]);

  const label = assets.find((a) => a.id === coinId)?.name ?? coinId;
  const hold = data?.rows.find((r) => r.strategyId === "buy_hold");
  const beatHold =
    data && hold
      ? data.rows.filter((r) => r.totalReturn > hold.totalReturn).length
      : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="min-w-48 flex-1">
            <Label className="mb-2 text-xs" htmlFor="shootout-asset">
              Asset
            </Label>
            <Select value={coinId} onValueChange={onCoinIdChange}>
              <SelectTrigger id="shootout-asset" className="w-full">
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
          </div>
          <div className="min-w-40 flex-1">
            <Label className="mb-2 text-xs" htmlFor="shootout-window">
              Window
            </Label>
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger id="shootout-window" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    Last {w} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1 sm:min-w-56">
            Every strategy runs at its default settings on{" "}
            {formatUsd(CAPITAL)} of starting capital, with a 0.10% fee and 0.05%
            slippage on each fill.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Could not run the comparison</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? <Skeleton className="h-96 w-full rounded-xl" /> : null}

      {data && hold ? (
        <Card className={cn(loading && "opacity-60 transition-opacity")}>
          <CardHeader>
            <CardTitle className="text-sm">
              {label}, {data.days} days
              <span className="ml-2 font-normal text-muted-foreground">
                {formatDate(data.from)} – {formatDate(data.to)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              {beatHold === 0 ? (
                <>
                  Not one of the five active strategies beat simply buying and
                  holding over this window. That is the usual result, and it is
                  the single most useful thing this tool can show you.
                </>
              ) : (
                <>
                  {beatHold} of the five active strategies beat buying and
                  holding here. Try another asset or window before trusting
                  that: a rule that wins in one window and loses in the next was
                  fitted to the past, not to the market.
                </>
              )}
            </p>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8">#</TableHead>
                    <TableHead className="min-w-52">Strategy</TableHead>
                    <TableHead className="text-right">Return</TableHead>
                    <TableHead className="text-right">Final value</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">
                      Max drawdown
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      Sharpe
                    </TableHead>
                    <TableHead className="hidden text-right md:table-cell">
                      Orders
                    </TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      Fees paid
                    </TableHead>
                    <TableHead className="hidden text-right lg:table-cell">
                      Win rate
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row, i) => {
                    const isHold = row.strategyId === "buy_hold";
                    return (
                      <TableRow
                        key={row.strategyId}
                        className={cn(isHold && "bg-muted/40")}
                      >
                        <TableCell className="text-muted-foreground">
                          {i === 0 ? (
                            <TrophyIcon className="size-3.5 text-amber-400" />
                          ) : (
                            i + 1
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{row.name}</span>
                            {isHold ? (
                              <Badge variant="outline" className="text-[10px]">
                                Benchmark
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.tagline}
                          </div>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono tabular-nums",
                            row.totalReturn >= 0
                              ? "text-emerald-400"
                              : "text-rose-400",
                          )}
                        >
                          {formatPct(row.totalReturn)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatUsd(row.finalEquity)}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                          {formatPct(row.maxDrawdown)}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                          {row.sharpe.toFixed(2)}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                          {row.tradeCount}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground lg:table-cell">
                          {formatUsd(row.feesPaid)}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground lg:table-cell">
                          {row.winRate === null
                            ? "—"
                            : formatPlainPct(row.winRate, 0)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
