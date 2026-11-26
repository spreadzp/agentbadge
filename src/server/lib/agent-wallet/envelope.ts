// SLICE-155-2: platform spend envelope — caps enforcement over
// SpendLedger. Enforcer/gate/withEnvelope live in enforcer.ts.
//
// Rolling windows (now − windowSec) over reserved+settled entries —
// released/failed free their amount. Caps are monotonic:
// perTx ≤ daily ≤ weekly ≤ monthly.

import type { SpendCaps } from "./registry";
import {
  newSpendId,
  WINDOW_SEC,
  type SpendEntry,
  type SpendKind,
  type SpendLedger,
} from "./ledger";
import { windowUsage, windowCount } from "./window";

/* ------------------------------ caps validate ----------------------------- */

// validateCaps moved to caps.ts (300-line guard) — re-exported so
// envelope.ts stays the single import surface.
export { validateCaps } from "./caps";

/* ------------------------------ check/reserve ----------------------------- */

export interface EnvelopeDeny {
  cap:
  | "perTx"
  | "velocity_tx"
  | "velocity_amount"
  | "daily"
  | "weekly"
  | "monthly";
  /** Current usage — USD for amount caps, entry count for velocity_tx. */
  used: number;
  limit: number;
  /** Epoch seconds when cap space starts freeing (rolling window). */
  resetAt: number;
}

export type EnvelopeVerdict =
  | {
      allow: true;
      /** Effective amount — the ONLY source for reserve (D6). Equals
       *  requested unless the perTx clamp resolved a smaller value. */
      amount: number;
      /** MMF v0.5 §5 shape — present ONLY on an actual clamp (never
       *  emitted on ordinary spends). */
      clamped?: { requested: number; cap: number };
    }
  | { allow: false; deny: EnvelopeDeny };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function checkEnvelope(
  ledger: SpendLedger,
  caps: SpendCaps,
  wallet: string,
  amountUsd: number,
  now = Date.now(),
): Promise<EnvelopeVerdict> {
  // EPIC-263-1: perTx clamp resolution — draft §4 check-5 CAP_EXCEEDED.
  // With bounds.clamp a valid over-cap request authorizes at
  // effective=min(requested, cap) (D3, deterministic) instead of
  // denying; checks 6–9 (velocity/daily/weekly/monthly below) then run
  // on the EFFECTIVE amount. Without clamp the deny is byte-identical.
  let effective = amountUsd;
  let clamped: { requested: number; cap: number } | undefined;
  if (caps.perTxUsd !== undefined && amountUsd > caps.perTxUsd) {
    if (caps.clamp === true) {
      clamped = { requested: amountUsd, cap: caps.perTxUsd };
      effective = caps.perTxUsd;
    } else {
      return {
        allow: false,
        deny: {
          cap: "perTx",
          used: amountUsd,
          limit: caps.perTxUsd,
          resetAt: Math.floor(now / 1000),
        },
      };
    }
  }
  // SLICE-176-2: hourly velocity caps — cheap count-check first, then
  // amount. One windowCount scan feeds both. Boundary is exclusive.
  if (caps.maxTxPerHour !== undefined || caps.maxAmountPerHour !== undefined) {
    const { count, used, oldestAt } = await windowCount(
      ledger,
      wallet,
      WINDOW_SEC.hourly,
      now,
    );
    const resetAt = oldestAt
      ? Math.floor((oldestAt + WINDOW_SEC.hourly * 1000) / 1000)
      : Math.floor(now / 1000) + WINDOW_SEC.hourly;
    if (caps.maxTxPerHour !== undefined && count + 1 > caps.maxTxPerHour) {
      return {
        allow: false,
        deny: { cap: "velocity_tx", used: count, limit: caps.maxTxPerHour, resetAt },
      };
    }
    if (
      caps.maxAmountPerHour !== undefined &&
      round6(used + effective) > caps.maxAmountPerHour
    ) {
      return {
        allow: false,
        deny: {
          cap: "velocity_amount",
          used: round6(used),
          limit: caps.maxAmountPerHour,
          resetAt,
        },
      };
    }
  }
  const windows: Array<
    ["daily" | "weekly" | "monthly", number | undefined, number]
  > = [
      ["daily", caps.dailyUsd, WINDOW_SEC.daily],
      ["weekly", caps.weeklyUsd, WINDOW_SEC.weekly],
      ["monthly", caps.monthlyUsd, WINDOW_SEC.monthly],
    ];
  for (const [cap, limit, windowSec] of windows) {
    if (limit === undefined) continue;
    const { used, oldestAt } = await windowUsage(ledger, wallet, windowSec, now);
    if (round6(used + effective) > limit) {
      return {
        allow: false,
        deny: {
          cap,
          used: round6(used),
          limit,
          resetAt: oldestAt
            ? Math.floor((oldestAt + windowSec * 1000) / 1000)
            : Math.floor(now / 1000) + windowSec,
        },
      };
    }
  }
  return { allow: true, amount: effective, ...(clamped ? { clamped } : {}) };
}

/**
 * Atomic-enough reserve: check + insert in one store op sequence.
 * Sync backends can't interleave between the awaits (microtasks only);
 * under the db backend a check-then-insert window exists — acceptable:
 * the envelope is a self-imposed guardrail (enforcer.ts), over-reserve
 * is bounded by perTx caps and self-corrects on release/expiry.
 */
export async function reserve(
  ledger: SpendLedger,
  caps: SpendCaps,
  wallet: `0x${string}`,
  amountUsd: number,
  kind: SpendKind,
  refId: string,
  venueId?: string,
): Promise<{ ok: true; entry: SpendEntry } | { ok: false; deny: EnvelopeDeny }> {
  const verdict = await checkEnvelope(ledger, caps, wallet, amountUsd);
  if (!verdict.allow) return { ok: false, deny: verdict.deny };
  // D6: verdict.amount is the ONLY amount source — never the raw arg.
  return {
    ok: true,
    entry: await insertReserved(
      ledger,
      wallet,
      verdict.amount,
      kind,
      refId,
      venueId,
      verdict.clamped,
    ),
  };
}

/** Insert the reserved entry — split from reserve() (176-7) so the
 *  enforcer can interleave the approval-hold branch between
 *  checkEnvelope and the insert without double-scanning windows. */
export async function insertReserved(
  ledger: SpendLedger,
  wallet: `0x${string}`,
  amountUsd: number,
  kind: SpendKind,
  refId: string,
  venueId?: string,
  /** EPIC-263-1: verdict.clamped verbatim — entry.amountUsd is the
   *  effective amount; requested/cap stored for audit (Q3 mirror). */
  clamped?: { requested: number; cap: number },
): Promise<SpendEntry> {
  const entry: SpendEntry = {
    id: newSpendId(),
    wallet,
    amountUsd,
    kind,
    refId,
    state: "reserved",
    at: Date.now(),
    ...(venueId ? { venueId } : {}),
    ...(clamped
      ? {
          clamped: true,
          requestedAmountUsd: clamped.requested,
          effectiveCapUsd: clamped.cap,
        }
      : {}),
  };
  await ledger.insert(entry);
  return entry;
}

export function settleEntry(
  ledger: SpendLedger,
  id: string,
  txHash?: string,
): Promise<boolean> {
  return ledger.transition(id, "settled", txHash);
}
export const releaseEntry = (ledger: SpendLedger, id: string): Promise<boolean> =>
  ledger.transition(id, "released");
export const failEntry = (ledger: SpendLedger, id: string): Promise<boolean> =>
  ledger.transition(id, "failed");
