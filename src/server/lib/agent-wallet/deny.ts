// SLICE-176-2: envelope deny side-effects extracted from enforcer.ts
// (300-line guard). One place that decides what a denied spend leaves
// behind: durable denied ledger entry (155-11, fail-closed), the right
// alert type, and the client-safe 402 deny-JSON body.
//
// Wire convention: cap denies → error "spend_cap"; velocity denies →
// error = deny.cap ("velocity_tx" | "velocity_amount") + windowSec.

import { newSpendId, type SpendKind, type SpendLedger } from "./ledger";
import type { EnvelopeDeny } from "./envelope";
import type {
  ApprovalMeta,
  ApprovalReason,
  ApprovalStore,
} from "./approvals";
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
  /**
   * 257-4: counterparty-hold fields — when present the park is a
   * find-or-create over (wallet, dealFingerprint) and the permit binds
   * THIS deal only (D-257-Q6). Amount-cap holds leave them undefined.
   */
  approvalReason?: ApprovalReason;
  dealFingerprint?: string;
  fingerprintVersion?: 1;
  meta?: ApprovalMeta;
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

/**
 * EPIC-263-1: amount-validity gate — NaN/±Infinity/zero/negative deny
 * BEFORE any caps check (draft §4 NON_POSITIVE ordering, K08; closes
 * the V04/V17/V29/V33 class on the enforcer path). Durable denied
 * entry keeps convention; non-finite amounts can't persist to the
 * ledger backends → recorded as 0, the raw attempt lives in the alert.
 */
export async function emitInvalidAmountDeny(
  ledger: SpendLedger,
  ctx: SpendDenyCtx,
): Promise<Record<string, unknown>> {
  await ledger.insert({
    id: newSpendId(),
    wallet: ctx.wallet,
    amountUsd: Number.isFinite(ctx.amountUsd) ? ctx.amountUsd : 0,
    kind: ctx.kind,
    refId: ctx.refId,
    state: "denied",
    denialReason: "invalid_amount",
    at: Date.now(),
    ...(ctx.venueId ? { venueId: ctx.venueId } : {}),
  });
  emitSpendAlert(
    "spend.invalid_amount",
    ctx.address,
    {
      attemptedAmountUsd: String(ctx.amountUsd),
      kind: ctx.kind,
      refId: ctx.refId,
    },
    ctx.venueId,
  );
  return { error: "invalid_amount" };
}

/**
 * SLICE-176-4: kill-switch deny — suspended wallet, first branch of
 * enforcer.begin (before kind/permit/caps). Durable denied entry +
 * wallet.suspended_deny alert for the owner.
 */
export async function emitSuspendedDeny(
  ledger: SpendLedger,
  ctx: SpendDenyCtx,
): Promise<Record<string, unknown>> {
  await ledger.insert({
    id: newSpendId(),
    wallet: ctx.wallet,
    amountUsd: ctx.amountUsd,
    kind: ctx.kind,
    refId: ctx.refId,
    state: "denied",
    denialReason: "spend_suspended",
    at: Date.now(),
    ...(ctx.venueId ? { venueId: ctx.venueId } : {}),
  });
  emitSpendAlert(
    "wallet.suspended_deny",
    ctx.address,
    {
      kind: ctx.kind,
      amountUsd: ctx.amountUsd,
      refId: ctx.refId,
    },
    ctx.venueId,
  );
  return { error: "spend_suspended" };
}

/**
 * SLICE-176-7: approval hold — платёж выше approvalAboveUsd паркуется
 * как pending intent вместо reserve; silence = denial (TTL). Леджер
 * не трогается: pending-заявки НЕ едят кап-пространство (D-176-7).
 * Throws "approval_queue_full" над per-wallet cap — caller мапит в 402.
 */
export async function emitApprovalHold(
  approvals: ApprovalStore,
  ctx: SpendDenyCtx,
  ttlMs: number,
): Promise<Record<string, unknown>> {
  const expiresAt = Date.now() + ttlMs;
  const a = await approvals.park({
    wallet: ctx.wallet,
    amountUsd: ctx.amountUsd,
    kind: ctx.kind,
    refId: ctx.refId,
    expiresAt,
    ...(ctx.approvalReason ? { approvalReason: ctx.approvalReason } : {}),
    ...(ctx.dealFingerprint ? { dealFingerprint: ctx.dealFingerprint } : {}),
    ...(ctx.fingerprintVersion
      ? { fingerprintVersion: ctx.fingerprintVersion }
      : {}),
    ...(ctx.meta ? { meta: ctx.meta } : {}),
  });
  emitSpendAlert(
    "approval.requested",
    ctx.address,
    {
      approvalId: a.id,
      amountUsd: ctx.amountUsd,
      kind: ctx.kind,
      refId: ctx.refId,
      expiresAt: a.expiresAt,
      // 257-4: owner sees WHY the hold exists + the check details —
      // safe fields only (no URLs, no secrets).
      ...(a.approvalReason ? { approvalReason: a.approvalReason } : {}),
      ...(a.dealFingerprint ? { dealFingerprint: a.dealFingerprint } : {}),
      ...(a.meta ? { meta: a.meta } : {}),
    },
    ctx.venueId,
  );
  return {
    error: "approval_required",
    action: "owner-approval-required",
    approvalId: a.id,
    expiresAt: a.expiresAt,
    amountUsd: ctx.amountUsd,
    kind: ctx.kind,
    ...(a.approvalReason ? { approvalReason: a.approvalReason } : {}),
    ...(a.dealFingerprint ? { dealFingerprint: a.dealFingerprint } : {}),
    ...(a.meta ? { meta: a.meta } : {}),
  };
}

/** 176-7: hold or queue-full — both land as 402 bodies in deny-JSON
 *  convention (`error` = wire code); park errors above cap surface
 *  as `approval_queue_full` instead of a parked intent. */
export async function tryApprovalHold(
  approvals: ApprovalStore,
  ctx: SpendDenyCtx,
  ttlMs: number,
): Promise<Record<string, unknown>> {
  try {
    return await emitApprovalHold(approvals, ctx, ttlMs);
  } catch (e) {
    if (e instanceof Error && e.message === "approval_queue_full") {
      return { error: "approval_queue_full" };
    }
    throw e;
  }
}
