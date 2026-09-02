/**
 * Deterministic credit scoring over verified history only.
 *
 * Every input here was either decoded from a proven source-chain receipt by the CreditPassport
 * contract or read from the chains directly. Nothing self-reported enters the score.
 */

export interface VerifiedProfile {
  datedVolume: bigint; // raw token units (6 decimals)
  undatedVolume: bigint;
  onTimeCount: number;
  lateCount: number;
  transferCount: number;
  firstPaidBlock: number;
  lastPaidBlock: number;
}

export interface ScoreFactor {
  name: string;
  points: number;
  detail: string;
}

export interface ScoreResult {
  score: number; // 0..1000
  factors: ScoreFactor[];
  limitFactor: number; // share of the policy cap the agent is willing to extend, 0..1
}

export const TOKEN_DECIMALS = 6n;
const UNIT = 10n ** TOKEN_DECIMALS;
/** Sepolia produces a block roughly every 12 seconds. */
export const BLOCKS_PER_DAY = 7_200;

export function toUnits(raw: bigint): number {
  return Number(raw / UNIT) + Number(raw % UNIT) / Number(UNIT);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function scoreProfile(profile: VerifiedProfile, currentSourceBlock: number): ScoreResult {
  const factors: ScoreFactor[] = [];
  const dated = profile.onTimeCount + profile.lateCount;
  const totalPayments = dated + profile.transferCount;

  if (totalPayments === 0) {
    return {
      score: 0,
      factors: [{ name: "no-history", points: 0, detail: "No verified payments on record." }],
      limitFactor: 0,
    };
  }

  factors.push({ name: "base", points: 300, detail: "Starting point for any wallet with at least one verified payment." });

  // Payment behaviour: up to 400 points from the on-time ratio, minus 40 per late payment.
  if (dated > 0) {
    const ratio = profile.onTimeCount / dated;
    const behaviour = clamp(Math.round(400 * ratio - 40 * profile.lateCount), 0, 400);
    factors.push({
      name: "payment-behaviour",
      points: behaviour,
      detail: `${profile.onTimeCount} of ${dated} dated invoices paid on time (${Math.round(ratio * 100)}%), ${profile.lateCount} late.`,
    });
  } else {
    factors.push({
      name: "payment-behaviour",
      points: 100,
      detail: "Only undated transfers verified; no due dates to measure punctuality against.",
    });
  }

  // Track record depth: up to 150 points.
  const depth = clamp(25 * dated + 5 * profile.transferCount, 0, 150);
  factors.push({
    name: "track-record",
    points: depth,
    detail: `${dated} dated and ${profile.transferCount} undated verified payments.`,
  });

  // Tenure: up to 100 points, 10 per day between first and last verified payment.
  const spanBlocks = Math.max(0, profile.lastPaidBlock - profile.firstPaidBlock);
  const spanDays = spanBlocks / BLOCKS_PER_DAY;
  const tenure = clamp(Math.round(spanDays * 10), 0, 100);
  factors.push({
    name: "tenure",
    points: tenure,
    detail: `Verified history spans ${spanBlocks} source blocks (~${spanDays.toFixed(1)} days).`,
  });

  // Volume: up to 50 points on a log scale of dated volume in whole units.
  const volumeUnits = toUnits(profile.datedVolume + profile.undatedVolume / 2n);
  const volume = clamp(Math.round(12.5 * Math.log10(volumeUnits + 1)), 0, 50);
  factors.push({
    name: "volume",
    points: volume,
    detail: `Verified settlement volume ${volumeUnits.toFixed(2)} (undated transfers at half weight).`,
  });

  // Recency: lose 50 points if the last verified payment is more than 30 days old.
  const sinceLast = Math.max(0, currentSourceBlock - profile.lastPaidBlock);
  const stale = sinceLast > 30 * BLOCKS_PER_DAY;
  factors.push({
    name: "recency",
    points: stale ? -50 : 0,
    detail: stale
      ? `Last verified payment ${(sinceLast / BLOCKS_PER_DAY).toFixed(0)} days ago.`
      : `Last verified payment ${(sinceLast / BLOCKS_PER_DAY).toFixed(1)} days ago.`,
  });

  const score = clamp(factors.reduce((sum, f) => sum + f.points, 0), 0, 1000);
  return { score, factors, limitFactor: limitFactorFor(score) };
}

/** How much of the contract's policy cap the agent extends at a given score. */
export function limitFactorFor(score: number): number {
  if (score >= 750) return 1;
  if (score >= 600) return 0.8;
  if (score >= 450) return 0.6;
  if (score > 0) return 0.4;
  return 0;
}

/** Requested limit: the agent's share of the policy cap, floored to whole token units. */
export function requestedLimit(policyMax: bigint, limitFactor: number): bigint {
  const bps = BigInt(Math.round(limitFactor * 10_000));
  const raw = (policyMax * bps) / 10_000n;
  return (raw / UNIT) * UNIT;
}
