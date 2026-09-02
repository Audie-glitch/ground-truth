"use client";

import { useEffect, useState } from "react";
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
  userInput?: { stage: string | null; hint: string | null; hasEthereum: boolean };
};

export function ConnectPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [appId, setAppId] = useState("");
  const [ethereumAddress, setEthereumAddress] = useState("");
  const [busy, setBusy] = useState(false);

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

      {status?.ethereum ? (
        <Alert>
          <AlertTitle>Agent Ethereum address</AlertTitle>
          <AlertDescription className="font-mono break-all">{status.ethereum}</AlertDescription>
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
          <CardTitle>Approve Phantom Connect</CardTitle>
          <CardDescription>
            This opens Phantom in your browser. Sign in with Google or Apple. This VM cannot complete that
            step. Unused codes refresh automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.waiting && status.url ? (
            <>
              <p className="text-sm text-muted-foreground">
                Code <span className="font-mono text-foreground">{status.userCode}</span> · {minutes}m{" "}
                {seconds.toString().padStart(2, "0")}s left
              </p>
              <Button asChild size="lg">
                <a href={status.url} target="_blank" rel="noreferrer">
                  Open Phantom Connect
                </a>
              </Button>
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
          <CardTitle>Or unblock without Connect</CardTitle>
          <CardDescription>
            Paste a Phantom Portal App ID from{" "}
            <a className="underline" href="https://phantom.com/portal" target="_blank" rel="noreferrer">
              phantom.com/portal
            </a>
            , or an Ethereum address you already control. Never paste a seed phrase or private key.
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
              <Label htmlFor="ethereumAddress">Your Ethereum address</Label>
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
    </div>
  );
}
