// SLICE-155-2: platform spend envelope — caps enforcement over
// SpendLedger. Enforcer/gate/withEnvelope live in enforcer.ts.
//
// Rolling windows (now − windowSec) over reserved+settled entries —
// released/failed free their amount. Caps are monotonic:
// perTx ≤ daily ≤ weekly ≤ monthly.

import type { SpendCaps } from "./registry";
import {
  newSpendId,
  windowUsage,
  WINDOW_SEC,
  type SpendEntry,
  type SpendKind,
  type SpendLedger,
} from "./ledger";

/* ------------------------------ caps validate ----------------------------- */

const CAP_KEYS = ["perTxUsd", "dailyUsd", "weeklyUsd", "monthlyUsd"] as const;

/**
 * Validate + normalize caps: numeric ≥0, monotonic
 * perTx ≤ daily ≤ weekly ≤ monthly (only across provided fields).
 * Throws Error with client-safe message.
 */
export function validateCaps(raw: unknown): SpendCaps {
  if (raw == null || typeof raw !== "object") {
    throw new Error("caps must be an object");
  }
  const src = raw as Record<string, unknown>;
  const caps: SpendCaps = {};
  for (const k of CAP_KEYS) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${k} must be a non-negative number`);
    }
    caps[k] = n;
  }
  const seq = CAP_KEYS.map((k) => caps[k]).filter(
    (v): v is number => v !== undefined,
  );
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1]) {
      throw new Error(
        "caps must be monotonic: perTx ≤ daily ≤ weekly ≤ monthly",
      );
    }
  }
  return caps;
}

/* ------------------------------ check/reserve ----------------------------- */

export interface EnvelopeDeny {
  cap: "perTx" | "daily" | "weekly" | "monthly";
  used: number;
  limit: number;
  /** Epoch seconds when cap space starts freeing (rolling window). */
  resetAt: number;
}

export type EnvelopeVerdict =
  | { allow: true }
  | { allow: false; deny: EnvelopeDeny };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function checkEnvelope(
  ledger: SpendLedger,
  caps: SpendCaps,
  wallet: string,
  amountUsd: number,
  now = Date.now(),
): EnvelopeVerdict {
  if (caps.perTxUsd !== undefined && amountUsd > caps.perTxUsd) {
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
  const windows: Array<
    [Exclude<EnvelopeDeny["cap"], "perTx">, number | undefined, number]
  > = [
    ["daily", caps.dailyUsd, WINDOW_SEC.daily],
    ["weekly", caps.weeklyUsd, WINDOW_SEC.weekly],
    ["monthly", caps.monthlyUsd, WINDOW_SEC.monthly],
  ];
  for (const [cap, limit, windowSec] of windows) {
    if (limit === undefined) continue;
    const { used, oldestAt } = windowUsage(ledger, wallet, windowSec, now);
    if (round6(used + amountUsd) > limit) {
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
  return { allow: true };
}

/**
 * Atomic-enough reserve: check + insert in one sync store op sequence.
 * JS runs handlers single-threaded per event loop turn — the check-then-
 * insert window can't interleave, so boundary races serialize correctly.
 */
export function reserve(
  ledger: SpendLedger,
  caps: SpendCaps,
  wallet: `0x${string}`,
  amountUsd: number,
  kind: SpendKind,
  refId: string,
): { ok: true; entry: SpendEntry } | { ok: false; deny: EnvelopeDeny } {
  const verdict = checkEnvelope(ledger, caps, wallet, amountUsd);
  if (!verdict.allow) return { ok: false, deny: verdict.deny };
  const entry: SpendEntry = {
    id: newSpendId(),
    wallet,
    amountUsd,
    kind,
    refId,
    state: "reserved",
    at: Date.now(),
  };
  ledger.insert(entry);
  return { ok: true, entry };
}

export function settleEntry(
  ledger: SpendLedger,
  id: string,
  txHash?: string,
): boolean {
  return ledger.transition(id, "settled", txHash);
}
export const releaseEntry = (ledger: SpendLedger, id: string): boolean =>
  ledger.transition(id, "released");
export const failEntry = (ledger: SpendLedger, id: string): boolean =>
  ledger.transition(id, "failed");
