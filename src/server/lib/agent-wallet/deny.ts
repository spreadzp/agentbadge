// SLICE-176-2: envelope deny side-effects extracted from enforcer.ts
// (300-line guard). One place that decides what a denied spend leaves
// behind: durable denied ledger entry (155-11, fail-closed), the right
// alert type, and the client-safe 402 deny-JSON body.
//
// Wire convention: cap denies → error "spend_cap"; velocity denies →
// error = deny.cap ("velocity_tx" | "velocity_amount") + windowSec.

import { newSpendId, type SpendKind, type SpendLedger } from "./ledger";
import type { EnvelopeDeny } from "./envelope";
import { emitSpendAlert } from "./audit";

export interface SpendDenyCtx {
  /** Lowercased wallet resolved from the request — ledger entry owner. */
  wallet: `0x${string}`;
  /** Registry record address — alert subject. */
  address: `0x${string}`;
  venueId?: string;
  amountUsd: number;
  kind: SpendKind;
  refId: string;
}

/**
 * Persist the denied entry, emit `spend.cap_denied` or
 * `spend.velocity_denied`, return the deny-JSON body for a 402.
 */
export async function emitSpendDeny(
  ledger: SpendLedger,
  deny: EnvelopeDeny,
  ctx: SpendDenyCtx,
): Promise<Record<string, unknown>> {
  // SLICE-155-11: durable denied entry — denialReason in the ledger,
  // not just the alert store; write fails → request fails (fail-closed).
  await ledger.insert({
    id: newSpendId(),
    wallet: ctx.wallet,
    amountUsd: ctx.amountUsd,
    kind: ctx.kind,
    refId: ctx.refId,
    state: "denied",
    denialReason: deny.cap,
    at: Date.now(),
    ...(ctx.venueId ? { venueId: ctx.venueId } : {}),
  });
  // SLICE-176-2: velocity denies get own alert type + wire code.
  const isVelocity =
    deny.cap === "velocity_tx" || deny.cap === "velocity_amount";
  emitSpendAlert(
    isVelocity ? "spend.velocity_denied" : "spend.cap_denied",
    ctx.address,
    {
      cap: deny.cap,
      used: deny.used,
      limit: deny.limit,
      resetAt: deny.resetAt,
      ...(isVelocity ? { windowSec: 3600 } : {}),
      amountUsd: ctx.amountUsd,
      kind: ctx.kind,
      refId: ctx.refId,
    },
    ctx.venueId,
  );
  return {
    error: isVelocity ? deny.cap : "spend_cap",
    cap: deny.cap,
    used: deny.used,
    limit: deny.limit,
    resetAt: deny.resetAt,
    ...(isVelocity ? { windowSec: 3600 } : {}),
  };
}

/**
 * SLICE-176-3: kind deny — allowedKinds задан и kind ∉ списка.
 * Дешёвая ветка до reserve: denied entry durable, но caps не тратятся
 * (denied-entries не считаются в window-метриках).
 */
export async function emitKindDeny(
  ledger: SpendLedger,
  ctx: SpendDenyCtx,
  allowedKinds: readonly SpendKind[],
): Promise<Record<string, unknown>> {
  await ledger.insert({
    id: newSpendId(),
    wallet: ctx.wallet,
    amountUsd: ctx.amountUsd,
    kind: ctx.kind,
    refId: ctx.refId,
    state: "denied",
    denialReason: "kind_not_allowed",
    at: Date.now(),
    ...(ctx.venueId ? { venueId: ctx.venueId } : {}),
  });
  emitSpendAlert(
    "spend.kind_denied",
    ctx.address,
    {
      kind: ctx.kind,
      allowedKinds: [...allowedKinds],
      amountUsd: ctx.amountUsd,
      refId: ctx.refId,
    },
    ctx.venueId,
  );
  return {
    error: "kind_not_allowed",
    kind: ctx.kind,
    allowedKinds: [...allowedKinds],
  };
}
