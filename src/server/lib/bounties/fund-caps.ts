/**
 * SLICE-197-11: fund caps — extracted from fund.ts for the 300-line
 * file cap. Caps (Q11) are evaluated BEFORE any contract call, so an
 * over-cap attempt returns 402 spend_cap without touching the chain
 * (VULN-11 discipline: solvency checks live off-chain too). Rolling
 * usage is reconstructed from the transition audit log (reason
 * "funded", payload.amount) — no separate ledger.
 */
import {
  listBounties,
  listTransitions,
  type BountyRecord,
} from "./store";

// ─── Config / caps ─────────────────────────────────────────────

export const BOUNTY_MIN_USDC = () =>
  Number(process.env.BOUNTY_MIN_USDC ?? 1);
export const BOUNTY_MAX_USDC = () =>
  Number(process.env.BOUNTY_MAX_USDC ?? 5);
export const BOUNTY_DAILY_CAP_USDC = () =>
  Number(process.env.BOUNTY_DAILY_CAP_USDC ?? 25);
export const BOUNTY_WEEKLY_CAP_USDC = () =>
  Number(process.env.BOUNTY_WEEKLY_CAP_USDC ?? 100);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Funded USDC inside a rolling window, from the transition log. */
export function fundedSince(fromMs: number, now: number): number {
  let sum = 0;
  for (const b of listAllFunded()) {
    if (b.atMs >= fromMs && b.atMs <= now) sum += b.amount;
  }
  return sum;
}

function listAllFunded(): { atMs: number; amount: number }[] {
  const out: { atMs: number; amount: number }[] = [];
  for (const b of listBountiesAll()) {
    for (const t of listTransitions(b.bountyId)) {
      if (t.reason === "funded") {
        const amount = Number(
          (t.payload as { amount?: unknown })?.amount ?? 0,
        );
        if (Number.isFinite(amount) && amount > 0) {
          out.push({ atMs: t.atMs, amount });
        }
      }
    }
  }
  return out;
}

function listBountiesAll(): BountyRecord[] {
  return [
    ...listBounties({ status: "open" }),
    ...listBounties({ status: "claimed" }),
    ...listBounties({ status: "submitted" }),
    ...listBounties({ status: "passed" }),
    ...listBounties({ status: "failed" }),
    ...listBounties({ status: "rejected" }),
    ...listBounties({ status: "expired" }),
  ];
}

export type CapBlock =
  | { ok: true }
  | {
    ok: false;
    code: "spend_cap";
    cap: "single" | "daily" | "weekly";
    limit: number;
    used?: number;
    message: string;
  };

/** Caps evaluated before any contract call. */
export function checkFundCaps(
  amountUsdc: number,
  now: number,
): CapBlock {
  if (amountUsdc < BOUNTY_MIN_USDC() || amountUsdc > BOUNTY_MAX_USDC()) {
    return {
      ok: false, code: "spend_cap" as const, cap: "single",
      limit: BOUNTY_MAX_USDC(),
      message:
        `bounty budget ${amountUsdc} outside ` +
        `[${BOUNTY_MIN_USDC()}, ${BOUNTY_MAX_USDC()}] USDC`,
    };
  }
  const daily = fundedSince(now - DAY_MS, now);
  if (daily + amountUsdc > BOUNTY_DAILY_CAP_USDC()) {
    return {
      ok: false, code: "spend_cap" as const, cap: "daily",
      limit: BOUNTY_DAILY_CAP_USDC(), used: daily,
      message: `daily fund cap: ${daily} + ${amountUsdc} > ${BOUNTY_DAILY_CAP_USDC()}`,
    };
  }
  const weekly = fundedSince(now - WEEK_MS, now);
  if (weekly + amountUsdc > BOUNTY_WEEKLY_CAP_USDC()) {
    return {
      ok: false, code: "spend_cap" as const, cap: "weekly",
      limit: BOUNTY_WEEKLY_CAP_USDC(), used: weekly,
      message: `weekly fund cap: ${weekly} + ${amountUsdc} > ${BOUNTY_WEEKLY_CAP_USDC()}`,
    };
  }
  return { ok: true };
}
