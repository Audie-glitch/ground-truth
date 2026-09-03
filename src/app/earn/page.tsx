import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { rankWindows, type WindowState } from "@/lib/earn-status";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<WindowState, string> = {
  open: "Window open",
  "not-yet": "Not yet",
  closed: "Closed",
};

export default function EarnPage() {
  const now = new Date();
  const rows = rankWindows(now);

  return (
    <main className="mx-auto w-full max-w-7xl grow px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Earning desk
          </h1>
          <Badge variant="outline">No payout yet</Badge>
        </div>
        <p className="max-w-3xl text-pretty leading-relaxed text-muted-foreground">
          Legitimate, no-capital work that can pay crypto or stablecoins.
          Nothing here is a wallet, a deposit address, or a trade. A submitted
          project does not complete the goal — only an official result and an
          on-chain payout to an address you control does.
        </p>
        <p className="text-xs text-muted-foreground">
          Windows evaluated at {now.toISOString()}.
        </p>
      </header>

      <ol className="grid gap-4">
        {rows.map((row) => (
          <li key={row.id}>
            <Card>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">{row.title}</CardTitle>
                  <Badge
                    variant={row.state === "open" ? "default" : "outline"}
                  >
                    {STATE_LABEL[row.state]}
                  </Badge>
                </div>
                <CardDescription>
                  {row.event} · {row.pays}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm leading-relaxed">
                <p>{row.nextAction}</p>
                <p className="text-muted-foreground">
                  Code in <code>{row.repoPath}</code>
                </p>
                <p>
                  <a
                    href={row.href}
                    className="underline underline-offset-4 hover:text-foreground"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official listing
                  </a>
                  {row.id === "buidl-ctc" ? (
                    <>
                      {" · "}
                      <span className="text-muted-foreground">
                        Live verifier lives in{" "}
                        <code>creditpassport/web</code> at /verify
                      </span>
                    </>
                  ) : null}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-foreground text-base font-medium">
          Still needed from you
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Confirm you are 18+ and not in a sanctioned location.</li>
          <li>
            DoraHacks, ETHGlobal, Devpost, and GitHub accounts you control.
          </li>
          <li>
            A payout address you already control. Never a seed phrase or private
            key.
          </li>
          <li>
            Testnet faucet tokens for the CreditPassport deployer, or store your
            own testnet-only key as <code>TESTNET_DEPLOYER_PRIVATE_KEY</code>.
          </li>
        </ul>
        <p>
          Wallet setup, if you want an agent address later, is on{" "}
          <Link
            href="/connect"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Connect
          </Link>
          . The paper backtester is on the{" "}
          <Link
            href="/"
            className="underline underline-offset-4 hover:text-foreground"
          >
            home page
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
