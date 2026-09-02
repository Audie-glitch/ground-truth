import { ShieldOffIcon } from "lucide-react";

import { Desk } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { fetchTopCoins } from "@/lib/coingecko";
import type { CoinSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialCoins: CoinSummary[] = [];
  let initialError: string | null = null;

  try {
    initialCoins = await fetchTopCoins(25);
  } catch (error) {
    initialError =
      error instanceof Error ? error.message : "Could not load market data.";
  }

  return (
    <main className="mx-auto w-full max-w-7xl grow px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ground Truth
          </h1>
          <Badge variant="outline" className="gap-1.5">
            <ShieldOffIcon className="size-3" />
            Simulation only
          </Badge>
        </div>
        <p className="max-w-3xl text-pretty leading-relaxed text-muted-foreground">
          Test a trading strategy against real historical crypto prices, with
          exchange fees and slippage charged on every fill, and see it measured
          against the only benchmark that matters: buying once and doing
          nothing. This tool connects to no wallet, holds no keys, and cannot
          move funds.
        </p>
      </header>

      <Desk initialCoins={initialCoins} initialError={initialError} />

      <footer className="mt-10 space-y-2 border-t border-foreground/10 pt-6 text-xs leading-relaxed text-muted-foreground">
        <p className="max-w-3xl text-pretty">
          Past performance of a rule on past data is not evidence that the rule
          works. A strategy tuned until it looks good on one asset over one
          window has been fitted to that window, and the effect usually
          disappears the moment it meets new prices. Nothing here is financial
          advice.
        </p>
        <p>
          Market data from CoinGecko. Daily closes only, so intraday stops and
          take-profits fill at the next daily close rather than the moment they
          trigger.
        </p>
      </footer>
    </main>
  );
}
