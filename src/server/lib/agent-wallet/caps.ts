// SLICE-263-1: caps validation extracted from envelope.ts
// (300-line guard). envelope.ts re-exports validateCaps — import
// surface unchanged.

import type { SpendCaps } from "./registry";
import { type SpendKind, SPEND_KINDS } from "./ledger";

const CAP_KEYS = ["perTxUsd", "dailyUsd", "weeklyUsd", "monthlyUsd"] as const;

/** EPIC-176: non-monotonic USD thresholds (≥0, not in the cap chain). */
const OWNER_USD_KEYS = ["approvalAboveUsd", "maxAmountPerHour"] as const;

/**
 * Validate + normalize caps: numeric ≥0, monotonic
 * perTx ≤ daily ≤ weekly ≤ monthly (only across provided fields).
 * EPIC-176 owner controls: approvalAboveUsd/maxAmountPerHour ≥0,
 * maxTxPerHour integer ≥1, allowedKinds ⊆ SpendKind (empty = error —
 * unset means allow-all, empty would silently deny everything).
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
  for (const k of OWNER_USD_KEYS) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${k} must be a non-negative number`);
    }
    caps[k] = n;
  }
  const txPerHour = src.maxTxPerHour;
  if (txPerHour !== undefined && txPerHour !== null) {
    const n = Number(txPerHour);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("maxTxPerHour must be an integer ≥1");
    }
    caps.maxTxPerHour = n;
  }
  const kinds = src.allowedKinds;
  if (kinds !== undefined && kinds !== null) {
    if (!Array.isArray(kinds) || kinds.length === 0) {
      throw new Error(
        "allowedKinds must be a non-empty SpendKind array (unset = allow-all)",
      );
    }
    for (const k of kinds) {
      if (typeof k !== "string" || !SPEND_KINDS.has(k as SpendKind)) {
        throw new Error(`allowedKinds contains invalid kind "${String(k)}"`);
      }
    }
    caps.allowedKinds = kinds as SpendKind[];
  }
  // EPIC-263-1: clamp is owner-declared boolean only (draft §2.2 —
  // "MUST be boolean, else validation error"); absent = off (D4).
  const clamp = src.clamp;
  if (clamp !== undefined && clamp !== null) {
    if (typeof clamp !== "boolean") {
      throw new Error("clamp must be a boolean");
    }
    caps.clamp = clamp;
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
