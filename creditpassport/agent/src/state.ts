import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PendingStatus = "seen" | "attested" | "submitted" | "failed";

export interface PendingPayment {
  txHash: string;
  blockNumber: number;
  payer: string;
  payee: string;
  invoiceId: string;
  amount: string; // decimal string of raw units
  dueBlock: number;
  status: PendingStatus;
  seenAt: string;
  attempts: number;
  lastError?: string;
  submission?: { creditcoinTxHash: string; batchSize: number; at: string };
}

export interface UnderwritingRecord {
  payer: string;
  score: number;
  creditLimit: string;
  policyMax: string;
  paymentCount: number;
  memo: unknown;
  creditcoinTxHash: string;
  at: string;
}

export interface AgentState {
  version: 1;
  lastScannedBlock: number | null;
  pending: Record<string, PendingPayment>;
  underwritings: Record<string, UnderwritingRecord>;
  log: Array<{ at: string; level: "info" | "warn" | "error"; message: string }>;
}

const EMPTY: AgentState = { version: 1, lastScannedBlock: null, pending: {}, underwritings: {}, log: [] };
const MAX_LOG = 200;

export class StateStore {
  private readonly path: string;
  state: AgentState;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "agent-state.json");
    this.state = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as AgentState) : structuredClone(EMPTY);
  }

  save(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }

  log(level: "info" | "warn" | "error", message: string): void {
    const line = { at: new Date().toISOString(), level, message };
    this.state.log.push(line);
    if (this.state.log.length > MAX_LOG) this.state.log.splice(0, this.state.log.length - MAX_LOG);
    const prefix = `[${line.at}] ${level.toUpperCase()}`;
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`${prefix} ${message}`);
  }

  pendingByStatus(status: PendingStatus): PendingPayment[] {
    return Object.values(this.state.pending).filter((p) => p.status === status);
  }
}
