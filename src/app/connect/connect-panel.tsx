"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Status = {
  session: boolean;
  ethereum: string | null;
  solana: string | null;
  stage: string | null;
  userCode: string | null;
  url: string | null;
  ttlLeftSec: number;
  waiting: boolean;
  source?: string;
  kmsBlocked?: boolean;
  kmsType?: string | null;
  kmsDetail?: string | null;
  userInput?: {
    stage: string | null;
    hint: string | null;
    hasEthereum: boolean;
    ethereumAddress: string | null;
  };
};

type Balances = {
  ok: boolean;
  funded?: boolean;
  address?: string;
  checkedAt?: string;
  error?: string;
  chains?: {
    ethereum: { native: string; usdc: string; ok: boolean; error?: string };
    base: { native: string; usdc: string; ok: boolean; error?: string };
  };
};

export function ConnectPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [appId, setAppId] = useState("");
  const [ethereumAddress, setEthereumAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [balances, setBalances] = useState<Balances | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/connect-status", { cache: "no-store" });
        const data = (await res.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(null);
      }
    }
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const inspectAddress = status?.ethereum || status?.userInput?.ethereumAddress || null;

  useEffect(() => {
    if (!inspectAddress) {
      setBalances(null);
      return;
    }
    let cancelled = false;
    async function loadBalances() {
      try {
        const res = await fetch(
          `/api/address-balances?address=${encodeURIComponent(inspectAddress!)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as Balances;
        if (!cancelled) setBalances(data);
      } catch {
        if (!cancelled) setBalances({ ok: false, error: "Could not read public balances." });
      }
    }
    void loadBalances();
    return () => {
      cancelled = true;
    };
  }, [inspectAddress]);

  async function saveEthereumAddress(address: string) {
    const res = await fetch("/api/connect-input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ethereumAddress: address }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Could not save that address.");
    }
  }

  const connectInjectedWallet = useCallback(async () => {
    setWalletBusy(true);
    try {
      const injected = window as Window & {
        ethereum?: { request: (args: { method: string }) => Promise<unknown> };
        phantom?: { ethereum?: { request: (args: { method: string }) => Promise<unknown> } };
      };
      const provider = injected.ethereum || injected.phantom?.ethereum;
      if (!provider) {
        toast.error(
          "No injected wallet in this browser. Open this page on your desktop with MetaMask installed.",
        );
        return;
      }
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address) {
        toast.error("The wallet did not return an account.");
        return;
      }
      await saveEthereumAddress(address);
      setEthereumAddress("");
      try {
        const res = await fetch("/api/connect-status", { cache: "no-store" });
        setStatus((await res.json()) as Status);
      } catch {
        /* poller will pick it up */
      }
      toast.success("Saved the connected address. Public balances are loading.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet connect failed.");
    } finally {
      setWalletBusy(false);
    }
  }, []);

  useEffect(() => {
    const injected = window as Window & { ethereum?: unknown };
    if (!injected.ethereum) return;
    try {
      if (sessionStorage.getItem("gt-injected-autostart")) return;
      sessionStorage.setItem("gt-injected-autostart", "1");
    } catch {
      return;
    }
    void connectInjectedWallet();
  }, [connectInjectedWallet]);

  useEffect(() => {
    if (!status?.waiting || !status.url || status.session || status.kmsBlocked) return;
    try {
      if (sessionStorage.getItem("gt-connect-autostart")) return;
      sessionStorage.setItem("gt-connect-autostart", "1");
    } catch {
      return;
    }
    window.open("/connect/go", "_blank", "noopener,noreferrer");
  }, [status]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/connect-input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, ethereumAddress }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        classification?: { realWhitelistRow?: boolean; stub?: boolean };
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Could not save that input.");
        return;
      }
      if (data.classification?.stub) {
        toast.warning("Saved, but that App ID looks like a DCR stub, not a Portal app.");
      } else if (data.classification?.realWhitelistRow) {
        toast.success("Saved a real whitelist App ID. The agent can classify the device-code grant next.");
      } else {
        toast.success("Saved. The agent will pick this up on the next pass.");
      }
      setAppId("");
      setEthereumAddress("");
    } catch {
      toast.error("Network error while saving.");
    } finally {
      setBusy(false);
    }
  }

  const minutes = status ? Math.floor(status.ttlLeftSec / 60) : 0;
  const seconds = status ? status.ttlLeftSec % 60 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Ground Truth backtester
        </Link>
        <Badge variant="outline">{status?.session ? "Agent session present" : "No agent wallet yet"}</Badge>
      </div>

      {status?.kmsBlocked ? (
        <Alert>
          <AlertTitle>Connect approval reached Phantom, KMS still refused</AlertTitle>
          <AlertDescription>
            {status.kmsDetail ||
              "This self-registered app is whitelist-disabled. Paste a real Portal App ID below, or share a MetaMask address."}
          </AlertDescription>
        </Alert>
      ) : null}

      {status?.ethereum ? (
        <Alert>
          <AlertTitle>Agent Ethereum address</AlertTitle>
          <AlertDescription className="font-mono break-all">{status.ethereum}</AlertDescription>
        </Alert>
      ) : null}

      {inspectAddress && !status?.ethereum ? (
        <Alert>
          <AlertTitle>Your Ethereum address</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="font-mono break-all">{inspectAddress}</p>
            <p>
              This VM cannot sign for a personal MetaMask account. Use it to fund an agent address
              once Phantom Connect succeeds, or keep it here so balances can be checked.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {balances ? (
        <Alert>
          <AlertTitle>
            {balances.ok
              ? balances.funded
                ? "Public balances — funded"
                : "Public balances — empty"
              : "Public balances unavailable"}
          </AlertTitle>
          <AlertDescription>
            {balances.ok && balances.chains ? (
              <ul className="mt-1 space-y-1 font-mono text-xs">
                <li>
                  Ethereum: {balances.chains.ethereum.native} ETH · {balances.chains.ethereum.usdc}{" "}
                  USDC
                  {balances.chains.ethereum.error ? ` (${balances.chains.ethereum.error})` : ""}
                </li>
                <li>
                  Base: {balances.chains.base.native} ETH · {balances.chains.base.usdc} USDC
                  {balances.chains.base.error ? ` (${balances.chains.base.error})` : ""}
                </li>
              </ul>
            ) : (
              balances.error || "Lookup failed."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {status?.userInput?.stage && status.userInput.stage !== "empty" ? (
        <Alert>
          <AlertTitle>Saved input</AlertTitle>
          <AlertDescription>
            {status.userInput.stage === "no-device-grant"
              ? status.userInput.hint ||
                "That Portal app does not have the device-code grant. Run phantom login on your desktop and paste only the Ethereum address."
              : status.userInput.stage === "not-portal-app"
                ? "That App ID is not a real Portal whitelist row."
                : status.userInput.stage === "ethereum-only"
                  ? "Stored your Ethereum address. The agent still cannot sign for it from this VM."
                  : status.userInput.stage === "portal-waiting"
                    ? "Your Portal App ID has a device-code grant. Use the Connect button below."
                    : `Status: ${status.userInput.stage}`}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>1. Paste a Phantom Portal App ID</CardTitle>
          <CardDescription>
            Create an app at{" "}
            <a className="underline" href="https://phantom.com/portal" target="_blank" rel="noreferrer">
              phantom.com/portal
            </a>
            , then paste the App ID. That is the path most likely to provision a signable agent
            wallet. Never paste a seed phrase or private key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="appId">Phantom App ID</Label>
              <Input
                id="appId"
                name="appId"
                autoComplete="off"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ethereumAddress">Or an Ethereum address you already control</Label>
              <Input
                id="ethereumAddress"
                name="ethereumAddress"
                autoComplete="off"
                placeholder="0x…"
                value={ethereumAddress}
                onChange={(event) => setEthereumAddress(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save for the agent"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Approve Phantom Connect</CardTitle>
          <CardDescription>
            Sign in with Google or Apple. Unused codes refresh automatically. The current
            self-registered app is a stub whitelist row, so KMS may still refuse after approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.waiting && status.url ? (
            <>
              <p className="text-sm text-muted-foreground">
                Code <span className="font-mono text-foreground">{status.userCode}</span> · {minutes}m{" "}
                {seconds.toString().padStart(2, "0")}s left
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="lg">
                  <a href="/connect/go">Open Phantom Connect</a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(status.url!);
                      toast.success("Copied the Connect link.");
                    } catch {
                      toast.error("Could not copy the link.");
                    }
                  }}
                >
                  Copy link
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {status?.session
                ? "A session file exists. Addresses will appear above once KMS returns them."
                : "Waiting for the next device code. Refresh in a few seconds."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Connect MetaMask</CardTitle>
          <CardDescription>
            Reads the injected address and public ETH/USDC balances only. This VM cannot sign for
            a personal MetaMask account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" size="lg" onClick={() => void connectInjectedWallet()} disabled={walletBusy}>
            {walletBusy ? "Connecting…" : "Connect MetaMask"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
