import { LiveVerifier } from "@/components/live-verifier";

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <div className="space-y-8">
      <section className="max-w-3xl space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Live check</div>
        <h1 className="text-3xl font-semibold tracking-tight">Run CreditPassport against the real verifier, right now</h1>
        <p className="text-muted-foreground">
          Paste any Sepolia transaction hash. The server fetches its Attestcoin proof from the hosted prover, asks the
          Creditcoin verifier precompile whether it is valid, then deploys a throwaway passport, registers the
          transaction&apos;s token, and calls <code>execute</code> with the proof, all inside one <code>eth_call</code>{" "}
          on the Creditcoin testnet. Nothing is deployed and no gas is spent. If the transaction carries an ERC-20
          transfer, you will see it recorded as a payment on a passport that existed only for the duration of the call.
        </p>
      </section>
      <LiveVerifier />
    </div>
  );
}
