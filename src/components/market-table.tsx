"use client";

import Image from "next/image";
import { FlaskConicalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCompactUsd, formatPctPoints, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CoinSummary } from "@/lib/types";

type Props = {
  coins: CoinSummary[];
  onBacktest: (coinId: string) => void;
};

export function MarketTable({ coins, onBacktest }: Props) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[40%] min-w-44">Asset</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">24h</TableHead>
            <TableHead className="hidden text-right sm:table-cell">7d</TableHead>
            <TableHead className="hidden text-right md:table-cell">
              Market cap
            </TableHead>
            <TableHead className="hidden text-right lg:table-cell">
              From all-time high
            </TableHead>
            <TableHead className="w-px" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {coins.map((coin) => (
            <TableRow key={coin.id}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <Image
                    src={coin.image}
                    alt=""
                    width={24}
                    height={24}
                    className="size-6 shrink-0 rounded-full"
                    unoptimized
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{coin.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {coin.symbol}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatUsd(coin.price)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono tabular-nums",
                  coin.change24h >= 0 ? "text-emerald-400" : "text-rose-400",
                )}
              >
                {formatPctPoints(coin.change24h)}
              </TableCell>
              <TableCell
                className={cn(
                  "hidden text-right font-mono tabular-nums sm:table-cell",
                  coin.change7d === null
                    ? "text-muted-foreground"
                    : coin.change7d >= 0
                      ? "text-emerald-400"
                      : "text-rose-400",
                )}
              >
                {coin.change7d === null ? "—" : formatPctPoints(coin.change7d)}
              </TableCell>
              <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground md:table-cell">
                {formatCompactUsd(coin.marketCap)}
              </TableCell>
              <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground lg:table-cell">
                {coin.athChangePct === null
                  ? "—"
                  : formatPctPoints(coin.athChangePct)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onBacktest(coin.id)}
                >
                  <FlaskConicalIcon />
                  <span className="hidden sm:inline">Backtest</span>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
