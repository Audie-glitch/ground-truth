"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircleIcon } from "lucide-react";

import { BacktestLab, type AssetOption } from "@/components/backtest-lab";
import { MarketTable } from "@/components/market-table";
import { PaperDesk } from "@/components/paper-desk";
import { StrategyShootout } from "@/components/strategy-shootout";
import { WalkForwardLab } from "@/components/walk-forward-lab";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FALLBACK_COINS } from "@/lib/fallback-coins";
import type { CoinSummary } from "@/lib/types";

type Props = {
  initialCoins: CoinSummary[];
  initialError: string | null;
};

const REFRESH_MS = 60_000;

export function Desk({ initialCoins, initialError }: Props) {
  const [coins, setCoins] = useState(initialCoins);
  const [marketError, setMarketError] = useState(initialError);
  const [tab, setTab] = useState("backtest");
  const [coinId, setCoinId] = useState(initialCoins[0]?.id ?? "bitcoin");

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const res = await fetch("/api/markets");
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(json.coins) && json.coins.length > 0) {
          setCoins(json.coins as CoinSummary[]);
          setMarketError(null);
        } else if (!res.ok) {
          setMarketError(json.error ?? "Could not refresh market data.");
        }
      } catch {
        if (!cancelled) setMarketError("Could not reach the market data feed.");
      }
    };

    if (initialCoins.length === 0) void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [initialCoins.length]);

  const assets = useMemo<AssetOption[]>(() => {
    if (coins.length > 0) {
      return coins.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name }));
    }
    return FALLBACK_COINS.map((c) => ({ ...c }));
  }, [coins]);

  // A coin chosen from the offline fallback list may not survive once the live
  // list loads, which would leave the picker showing nothing.
  const selectedCoinId = assets.some((a) => a.id === coinId)
    ? coinId
    : (assets[0]?.id ?? coinId);

  const openBacktest = useCallback((id: string) => {
    setCoinId(id);
    setTab("backtest");
  }, []);

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger value="backtest">Backtest</TabsTrigger>
        <TabsTrigger value="walkforward">Walk-forward</TabsTrigger>
        <TabsTrigger value="shootout">Strategy shootout</TabsTrigger>
        <TabsTrigger value="markets">Markets</TabsTrigger>
        <TabsTrigger value="paper">Paper desk</TabsTrigger>
      </TabsList>

      {marketError ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>Live prices are unavailable right now</AlertTitle>
          <AlertDescription>
            {marketError} Historical backtests still work; the market table and
            paper desk need this feed.
          </AlertDescription>
        </Alert>
      ) : null}

      <TabsContent value="backtest">
        <BacktestLab
          assets={assets}
          coinId={selectedCoinId}
          onCoinIdChange={setCoinId}
        />
      </TabsContent>

      <TabsContent value="walkforward">
        <WalkForwardLab
          assets={assets}
          coinId={selectedCoinId}
          onCoinIdChange={setCoinId}
        />
      </TabsContent>

      <TabsContent value="shootout">
        <StrategyShootout
          assets={assets}
          coinId={selectedCoinId}
          onCoinIdChange={setCoinId}
        />
      </TabsContent>

      <TabsContent value="markets">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Top 25 by market cap
              <span className="ml-2 font-normal text-muted-foreground">
                live, refreshed every minute
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {coins.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No market data loaded yet.
              </p>
            ) : (
              <MarketTable coins={coins} onBacktest={openBacktest} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="paper">
        <PaperDesk coins={coins} />
      </TabsContent>
    </Tabs>
  );
}
