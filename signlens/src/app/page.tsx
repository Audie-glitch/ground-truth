import { Eye, ShieldAlert } from "lucide-react";
import { Analyzer } from "@/components/analyzer";

export default function Home() {
  return (
    <>
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <Eye className="size-5 text-sky-400" aria-hidden />
            SignLens
          </div>
          <a href="#how" className="text-sm text-muted-foreground hover:text-foreground">
            How it works
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <section className="mb-8 max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Know what you are signing.</h1>
          <p className="mt-3 text-muted-foreground">
            Wallets show a function name and a hex blob. Drainers count on that. Paste the request a site sent to your
            wallet, whether it is a transaction, an EIP-712 message, or a plain signature, and SignLens tells you in one
            sentence what it lets whom do to your assets, then explains every risk it found.
          </p>
        </section>

        <Analyzer />

        <section id="how" className="mt-14 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="font-medium">Decode, then judge</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Calldata is decoded against the token, NFT, Permit2, router and admin function signatures drainers actually
              use. EIP-712 messages are recognised as permits, Permit2 grants, marketplace orders or unknown types with
              spender-like fields. Plain messages are checked for Sign-In with Ethereum and for hash-shaped payloads.
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="font-medium">Check who gets the power</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every spender, operator or recipient is looked up on-chain: is it a contract at all, and is its source
              verified on Sourcify? A permission granted to a plain wallet address is the single strongest drainer
              signal, and it is invisible in a normal wallet prompt.
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="font-medium">What it is not</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Not a simulation and not a guarantee. It reads the request, not the future state. Unknown functions are
              flagged, not understood. Use it alongside your wallet&apos;s own warnings, and revoke approvals you no
              longer need.
            </p>
          </div>
        </section>

        <p className="mt-8 flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Requests you paste are analysed on this server and, for address checks, sent as read-only calls to public RPC
          endpoints and Sourcify. Nothing is stored. Never paste a private key or seed phrase anywhere, including here.
        </p>
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        SignLens, built for 3rd-Web-Hack 2026. Open source, MIT.
      </footer>
    </>
  );
}
