export type OpportunityId =
  | "buidl-ctc"
  | "keeperhub-feature"
  | "ethonline"
  | "third-web-hack"
  | "mermail-skill"
  | "t3n-vendor-receipts";

export type WindowState = "not-yet" | "open" | "closed";

export type OpportunityWindow = {
  id: OpportunityId;
  title: string;
  event: string;
  pays: string;
  href: string;
  repoPath: string;
  opensAt: string;
  closesAt: string;
  state: WindowState;
  nextAction: string;
};

const WINDOWS: Omit<OpportunityWindow, "state">[] = [
  {
    id: "buidl-ctc",
    title: "CreditPassport",
    event: "BUIDL CTC 2026 Fall",
    pays: "$10k / $3k / $2k (USD-denominated; payout asset unconfirmed)",
    href: "https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail",
    repoPath: "creditpassport/",
    // Submissions opened 13 Aug 2026. Deadline 13 Sep 2026 23:59 ET (EDT, UTC−4).
    opensAt: "2026-08-13T00:00:00Z",
    closesAt: "2026-09-14T03:59:59Z",
    nextAction:
      "Testnet deploy is the remaining code step. Submission still needs your DoraHacks account, identity, and a public repo.",
  },
  {
    id: "keeperhub-feature",
    title: "OpenAPI workflow-call examples (#2105)",
    event: "KeeperHub Agent Economy — Best Feature",
    pays: "$500 × 2 in stablecoins",
    href: "https://dorahacks.io/hackathon/agent-economy/detail",
    repoPath: "keeperhub/2105-openapi-response-examples.md",
    // Official build window: 6 Sep 2026 00:00 CEST through 18 Sep 2026 12:00 CEST.
    opensAt: "2026-09-05T22:00:00Z",
    closesAt: "2026-09-18T10:00:00Z",
    nextAction:
      "Do not write KeeperHub source until the window opens. The patch spec is ready; recheck the issue and PRs on 6 Sep.",
  },
  {
    id: "ethonline",
    title: "Reconciled statement API over x402",
    event: "ETHOnline 2026",
    pays: "Hedera / Bazantic / Arc USDC tracks",
    href: "https://ethglobal.com/events/ethonline2026",
    repoPath: "x402-api/DESIGN.md",
    // ETHGlobal Start Fresh: no project-specific code before 4 Sep 16:00 UTC.
    opensAt: "2026-09-04T16:00:00Z",
    closesAt: "2026-09-16T23:59:59Z",
    nextAction:
      "Design only until 4 Sep 16:00 UTC. Register on ETHGlobal and stake 0.01 ETH (refunded on submit). Day-1: x402 scaffold plus AquaFloor (1inch Aqua App, aqua-app/DESIGN.md). Uniswap backup is sdks#720 (DCA EIP-712).",
  },
  {
    id: "third-web-hack",
    title: "SignLens",
    event: "3rd-Web-Hack",
    pays: "$500 / $200 / $50 USDT",
    href: "https://3rd-web-hack.devpost.com/",
    repoPath: "signlens/",
    opensAt: "2026-08-01T00:00:00Z",
    closesAt: "2026-09-27T23:59:59Z",
    nextAction:
      "Built. Needs your Devpost registration and a demo-video upload.",
  },
  {
    id: "mermail-skill",
    title: "mermail-onchain-receipts",
    event: "Superteam Earn — Mermail agent skill",
    pays: "$500 USDC (250 / 100 / 50 + 50 innovative + 50 best video)",
    href: "https://superteam.fun/earn/listing/build-and-demo-a-mermail-agent-skill",
    repoPath: "mermail-onchain-receipts/",
    opensAt: "2026-08-01T00:00:00Z",
    closesAt: "2026-09-23T13:59:59Z",
    nextAction:
      "Skill and patch are ready. Fork mermail-skills, open the PR, connect Mermail MCP, and post a 2–5 minute X demo tagging @Mermailapp.",
  },
  {
    id: "t3n-vendor-receipts",
    title: "Vendor Receipts TEE",
    event: "Superteam Earn — T3N agent build challenge",
    pays: "$290 USDC (100 / 50 / 50 / 30 / 30 / 30)",
    href: "https://superteam.fun/earn/listing/t3n-agent-build-challenge",
    repoPath: "t3n-vendor-receipts/",
    opensAt: "2026-08-01T00:00:00Z",
    // Listing deadline 16 Sep 2026 15:59:59.999Z
    closesAt: "2026-09-16T15:59:59.999Z",
    nextAction:
      "Contract and host are ready. Sign in at go.terminal3.io/adk-community, claim two keys, run quickstart/register/invoke, paste GOOGLE_DOC.md into a public Google Doc, and submit the Superteam form.",
  },
];

export function windowState(
  opensAt: string,
  closesAt: string,
  now: Date,
): WindowState {
  const t = now.getTime();
  if (t < Date.parse(opensAt)) return "not-yet";
  if (t > Date.parse(closesAt)) return "closed";
  return "open";
}

export function windowFor(id: OpportunityId, now: Date): OpportunityWindow {
  const row = WINDOWS.find((item) => item.id === id);
  if (!row) {
    throw new Error(`Unknown earning window: ${id}`);
  }
  return { ...row, state: windowState(row.opensAt, row.closesAt, now) };
}

const STATE_RANK: Record<WindowState, number> = {
  open: 0,
  "not-yet": 1,
  closed: 2,
};

export function rankWindows(now: Date): OpportunityWindow[] {
  return WINDOWS.map((row) => ({
    ...row,
    state: windowState(row.opensAt, row.closesAt, now),
  })).sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
}
