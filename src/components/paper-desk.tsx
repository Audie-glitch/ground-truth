"use client";

import { useMemo, useState } from "react";
import { RotateCcwIcon, WalletIcon } from "lucide-react";
import { toast } from "sonner";

import { MetricTile } from "@/components/metric-tile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatPct,
  formatUnits,
  formatUsd,
} from "@/lib/format";
import { emptyAccount, PAPER_FEE_BPS, placeOrder } from "@/lib/paper";
import { updatePaperAccount, usePaperAccount } from "@/lib/paper-store";
import type { CoinSummary, PaperAccount } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = { coins: CoinSummary[] };

export function PaperDesk({ coins }: Props) {
  const account = usePaperAccount();

  const priceOf = useMemo(() => {
    const map = new Map(coins.map((c) => [c.id, c.price]));
    return (id: string) => map.get(id) ?? 0;
  }, [coins]);

  const holdingsValue = useMemo(
    () =>
      account.positions.reduce(
        (sum, p) => sum + p.units * priceOf(p.coinId),
        0,
      ),
    [account, priceOf],
  );

  const equity = account.cash + holdingsValue;
  const totalReturn =
    account.startingCash > 0 ? equity / account.startingCash - 1 : 0;
  const feesPaid = account.fills.reduce((s, f) => s + f.fee, 0);

  const submit = (
    side: "buy" | "sell",
    coinId: string,
    amount: number,
  ): boolean => {
    const coin = coins.find((c) => c.id === coinId);
    if (!coin) {
      toast.error("No live price available for that asset right now.");
      return false;
    }
    const outcome = placeOrder(account, {
      coinId: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      side,
      amount,
      price: coin.price,
    });
    if (!outcome.ok) {
      toast.error(outcome.error);
      return false;
    }
    updatePaperAccount(outcome.account);
    toast.success(
      `${side === "buy" ? "Bought" : "Sold"} ${formatUnits(outcome.fill.units)} ${coin.symbol}`,
      { description: `Simulated fill at ${formatUsd(coin.price)}` },
    );
    return true;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          label="Account value"
          value={formatUsd(equity)}
          hint="Simulated cash plus the live market value of your simulated holdings."
        />
        <MetricTile
          label="Total return"
          value={formatPct(totalReturn)}
          tone={totalReturn >= 0 ? "good" : "bad"}
          sub={`from ${formatUsd(account.startingCash)}`}
          hint="Change against the starting balance of this paper account."
        />
        <MetricTile
          label="Cash"
          value={formatUsd(account.cash)}
          hint="Uninvested simulated cash available for new orders."
        />
        <MetricTile
          label="Fees paid"
          value={formatUsd(feesPaid)}
          tone={feesPaid > account.startingCash * 0.02 ? "bad" : "neutral"}
          sub={`${(PAPER_FEE_BPS / 100).toFixed(2)}% per order`}
          hint="Simulated trading costs. Real desks charge this whether you win or lose."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Positions</span>
            <span className="flex gap-2">
              <TradeDialog
                coins={coins}
                account={account}
                onSubmit={submit}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  updatePaperAccount(emptyAccount());
                  toast.success("Paper account reset to $10,000.");
                }}
              >
                <RotateCcwIcon />
                Reset
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {account.positions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <WalletIcon className="size-7 text-muted-foreground" />
              <div className="max-w-md text-pretty text-sm text-muted-foreground">
                No positions yet. You start with {formatUsd(account.startingCash)}{" "}
                of simulated cash and live market prices. Nothing here touches a
                real wallet, and there is no way to deposit or withdraw.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">
                      Avg cost
                    </TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">P&amp;L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {account.positions.map((p) => {
                    const price = priceOf(p.coinId);
                    const value = p.units * price;
                    const pnl = value - p.costBasis;
                    const pnlPct = p.costBasis > 0 ? pnl / p.costBasis : 0;
                    return (
                      <TableRow key={p.coinId}>
                        <TableCell>
                          <div className="font-medium">{p.symbol}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatUnits(p.units)}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                          {formatUsd(p.costBasis / p.units)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {price > 0 ? formatUsd(price) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatUsd(value)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono tabular-nums",
                            pnl >= 0 ? "text-emerald-400" : "text-rose-400",
                          )}
                        >
                          {formatUsd(pnl)}
                          <div className="text-xs opacity-80">
                            {formatPct(pnlPct)}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {account.fills.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Order history</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-56">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Time</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {account.fills.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(f.t).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "font-medium",
                            f.side === "buy"
                              ? "text-emerald-400"
                              : "text-rose-400",
                          )}
                        >
                          {f.side === "buy" ? "Buy" : "Sell"}
                        </span>{" "}
                        <span className="font-mono">
                          {formatUnits(f.units)} {f.symbol}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatUsd(f.price)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatUsd(f.notional)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatUsd(f.fee)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TradeDialog({
  coins,
  account,
  onSubmit,
}: {
  coins: CoinSummary[];
  account: PaperAccount;
  onSubmit: (side: "buy" | "sell", coinId: string, amount: number) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [coinId, setCoinId] = useState(coins[0]?.id ?? "");
  const [amount, setAmount] = useState("500");

  const sellable = account.positions;
  const options = side === "buy" ? coins : coins.filter((c) =>
    sellable.some((p) => p.coinId === c.id),
  );
  const active = options.find((c) => c.id === coinId) ?? options[0];
  const held = sellable.find((p) => p.coinId === active?.id);

  const switchSide = (next: "buy" | "sell") => {
    setSide(next);
    setAmount(next === "buy" ? "500" : "");
    const list = next === "buy" ? coins : coins.filter((c) =>
      sellable.some((p) => p.coinId === c.id),
    );
    if (!list.some((c) => c.id === coinId)) setCoinId(list[0]?.id ?? "");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={coins.length === 0}>
          New order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place a simulated order</DialogTitle>
          <DialogDescription>
            Fills at the current market price with a{" "}
            {(PAPER_FEE_BPS / 100).toFixed(2)}% fee. No real funds are involved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={side === "buy" ? "default" : "outline"}
              onClick={() => switchSide("buy")}
            >
              Buy
            </Button>
            <Button
              variant={side === "sell" ? "default" : "outline"}
              onClick={() => switchSide("sell")}
              disabled={sellable.length === 0}
            >
              Sell
            </Button>
          </div>

          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have nothing to sell yet.
            </p>
          ) : (
            <>
              <div>
                <Label className="mb-2 text-xs" htmlFor="order-asset">
                  Asset
                </Label>
                <Select value={active?.id ?? ""} onValueChange={setCoinId}>
                  <SelectTrigger id="order-asset" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {formatUsd(c.price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2 text-xs" htmlFor="order-amount">
                  {side === "buy" ? "Amount in USD" : `Units of ${active?.symbol ?? ""}`}
                </Label>
                <Input
                  id="order-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={side === "buy" ? "500" : "0.5"}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {side === "buy"
                    ? `${formatUsd(account.cash)} in simulated cash available.`
                    : held
                      ? `Holding ${formatUnits(held.units)} ${held.symbol}.`
                      : ""}
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!active}
            onClick={() => {
              if (!active) return;
              const value = Number(amount.replace(/[^0-9.]/g, ""));
              if (onSubmit(side, active.id, value)) setOpen(false);
            }}
          >
            {side === "buy" ? "Buy" : "Sell"} {active?.symbol ?? ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
