import { ConnectPanel } from "./connect-panel";

export const dynamic = "force-dynamic";

export default function ConnectPage() {
  return (
    <main className="mx-auto w-full max-w-2xl grow px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agent wallet setup</h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          Connect MetaMask here if you already have funds, or open Phantom Connect so this agent
          can receive a dedicated Ethereum address. Preview can send you straight to the live
          Connect page. After that address exists, send to it from MetaMask. Do not send funds to
          any key generated in chat.
        </p>
      </header>
      <ConnectPanel />
    </main>
  );
}
