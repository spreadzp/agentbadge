/**
 * EPIC-227 / SLICE-227-2 — payout completion service (D-227-4/5).
 *
 * Manual ops send the transfers off-band and mark legs paid with the
 * real txHash. The domain never fabricates a confirmation:
 * - txHash is format-validated, replay-bound per (network, hash)
 *   (unique index + check — the refund C3 pattern);
 * - a wired VerifyPayoutTx adapter must pass — every non-verified
 *   outcome fails closed typed (never blind trust);
 * - `requireVerification` without an adapter → VERIFIER_UNAVAILABLE
 *   (503-style) instead of the manual attestation path.
 *
 * Rollup: all legs COMPLETED → intent COMPLETED → milestone RELEASED
 * → plan COMPLETED when every milestone is terminal. The post-effect
 * AdminAction records the real outcome and surfaces `auditRecorded`
 * (review-1911 §3.2 — never a swallowed void).
 *
 * Concurrency: per-intent + per-tx in-process locks (finops
 * payment-mutex, same nesting order: intent scope first, tx second).
 */

import type {
  MilestoneRow,
  PayoutIntentRow,
  PayoutLegRow,
} from "@agentbadge/database";

import { recordPostEffectAudit } from "../../finops/admin-actions.js";
import {
  normalizeOperator,
  normalizeTxHash,
  requireOperator,
} from "../../finops/guards.js";
import {
  LockAcquireTimeoutError,
  withLock,
} from "../../finops/payment-mutex.js";
import { rollupIntent } from "./rollup.js";
import {
  type MarkPaidInput,
  type PayoutVerifyDeps,
  SettlementConflictError,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import { verifyLegTx } from "../verify-payout-tx.js";
import type { SettlementCtx } from "./ctx.js";

export interface MarkPaidResult {
  leg: PayoutLegRow;
  intent: PayoutIntentRow;
  milestone: MilestoneRow;
  /** false when the effect landed but the audit store failed —
   *  surfaced, never swallowed (stripe-refunds convention). */
  auditRecorded: boolean;
  /** true when a wired verifier attested the tx (manual attestation
   *  path reports null — honest about what was checked). */
  verified: boolean | null;
}

export async function markLegPaid(
  ctx: SettlementCtx,
  input: MarkPaidInput,
  deps: PayoutVerifyDeps = {},
): Promise<SettlementResult<MarkPaidResult>> {
  const op = requireOperator(input.operator);
  if (op) return op as SettlementResult<never>;
  const txHash =
    typeof input.txHash === "string" ? normalizeTxHash(input.txHash) : null;
  if (!txHash) {
    return fail(
      "BAD_INPUT",
      "txHash must be a 0x-prefixed 64-hex transaction hash",
    );
  }
  // Serialize per intent AND per txHash — two legs completed with the
  // same hash concurrently must not both pass the replay check.
  try {
    return await withLock("pay", `settle-intent:${input.intentId}`, () =>
      withLock("tx", txHash, () =>
        markLegPaidInner(ctx, input, deps, txHash),
      ),
    );
  } catch (e) {
    if (e instanceof LockAcquireTimeoutError) {
      return fail(
        "PROVIDER_ERROR",
        `mutation queue busy — retry mark-paid ${input.intentId}`,
      );
    }
    throw e;
  }
}

async function markLegPaidInner(
  ctx: SettlementCtx,
  input: MarkPaidInput,
  deps: PayoutVerifyDeps,
  txHash: string,
): Promise<SettlementResult<MarkPaidResult>> {
  const intent = await ctx.db.settlement.payoutIntents.getById(input.intentId);
  if (!intent) {
    return fail("NOT_FOUND", `payout intent not found: ${input.intentId}`);
  }
  if (intent.status !== "OPEN") {
    return fail(
      "INVALID_STATE",
      `payout intent is ${intent.status}, not OPEN`,
    );
  }
  // Resolve the leg: explicit legId, else the single OPEN leg.
  const legs = await ctx.db.settlement.payoutLegs.listByIntent(intent.id);
  let leg: PayoutLegRow | undefined;
  if (input.legId !== undefined) {
    leg = legs.find((l) => l.id === input.legId);
    if (!leg) {
      return fail(
        "NOT_FOUND",
        `leg ${input.legId} not found on intent ${intent.id}`,
      );
    }
  } else {
    const open = legs.filter((l) => l.status === "OPEN");
    if (open.length === 0) {
      return fail("INVALID_STATE", "intent has no OPEN legs");
    }
    if (open.length > 1) {
      return fail(
        "BAD_INPUT",
        `legId required — intent ${intent.id} has ${open.length} OPEN legs`,
      );
    }
    leg = open[0];
  }
  if (leg.status !== "OPEN") {
    return fail("INVALID_STATE", `payout leg is ${leg.status}, not OPEN`);
  }
  // Replay check — one real tx binds at most one leg per network.
  const bound = await ctx.db.settlement.payoutLegs.getByTxHash(
    leg.network ?? "arc",
    txHash,
  );
  if (bound) {
    return fail(
      "TX_REUSED",
      `txHash already bound to leg ${bound.id} — replay rejected`,
    );
  }
  const milestone = await ctx.db.settlement.milestones.getById(
    intent.milestoneRef,
  );
  if (!milestone) {
    return fail("NOT_FOUND", `milestone not found: ${intent.milestoneRef}`);
  }
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) {
    return fail("NOT_FOUND", `plan not found: ${milestone.planId}`);
  }

  // Verification seam (D-227-4): wired adapter must pass; absent
  // adapter is manual-ops attestation unless verification is required.
  let verified: boolean | null = null;
  if (deps.verifyTx) {
    const check = await verifyLegTx(deps.verifyTx, txHash, {
      payee: leg.payee,
      amount: leg.amountUsdc,
      currency: plan.currency ?? "USDC",
      network: leg.network ?? "arc",
      chainId: deps.chainId,
      token: deps.usdcToken,
      expectedPayer: deps.expectedPayer,
      notBeforeMs: intent.createdAtMs,
    });
    if (!check.ok) return check as SettlementResult<never>;
    verified = true;
  } else if (deps.requireVerification) {
    return fail(
      "VERIFIER_UNAVAILABLE",
      "payout verification required but no VerifyPayoutTx adapter is wired",
    );
  }

  // ---- effect: set-once txHash + rollup, one atomic section ----
  const operator = normalizeOperator(input.operator);
  const completedAtMs = Date.now();
  const buf = ctx.emit.buffer();
  let effect;
  try {
    effect = await ctx.db.settlement.atomic(async (s) => {
    // H2/hoist: re-read the intent inside the critical section BEFORE
    // writing the leg — a concurrent freeze/cancel must fail here, not
    // after the leg's txHash is bound.
    const live = await s.payoutIntents.getById(intent.id);
    if (!live || live.status !== "OPEN") {
      return fail(
        "INVALID_STATE",
        `payout intent is ${live?.status ?? "gone"} — leg not completed`,
      );
    }
    const done = await s.payoutLegs.complete(
      leg.id,
      "OPEN",
      txHash,
      operator,
      completedAtMs,
    );
    if (!done) {
      return fail(
        "INVALID_STATE",
        "leg moved concurrently or txHash already bound — not completed",
      );
    }
    // M-C: emit before the rollup so the event stream reads
    // leg → intent → milestone → plan, not backwards.
    buf.emit({
      entityType: "payout_leg",
      entityId: leg.id,
      eventType: "leg.completed",
      actorWallet: operator,
      payload: { intentId: intent.id, txHash, verified },
    });
    // H1: shared rollup — non-CANCELLED legs all COMPLETED → intent
    // COMPLETED → milestone RELEASED → plan COMPLETED (rollup.ts).
    const rolled = await rollupIntent(
      buf,
      s,
      live,
      milestone,
      plan.id,
      operator,
    );
    if (rolled === "MOVED") {
      // R2-H3: the leg is already COMPLETED with its txHash bound —
      // `return fail` would commit a paid leg under a moved (frozen)
      // intent and poison every retry with TX_REUSED. Throw to roll
      // the whole atomic back instead.
      throw new SettlementConflictError(
        `intent ${live.id} moved concurrently — rollup aborted`,
      );
    }
    const { intent: nextIntent, milestone: nextMilestone } = rolled;
    return ok({ leg: done, intent: nextIntent, milestone: nextMilestone });
    });
  } catch (err) {
    if (err instanceof SettlementConflictError) {
      return fail(err.code, err.message);
    }
    throw err;
  }
  if (effect.ok) await buf.flush();
  if (!effect.ok) return effect;

  // ---- post-effect audit — surfaced, never swallowed ----
  const audit = await recordPostEffectAudit(
    ctx.db,
    {
      action: "MARK_PAYOUT_PAID",
      subjectType: "payout_leg",
      subjectId: leg.id,
      operator,
      principalId: input.principalId,
      evidence: {
        intentId: intent.id,
        milestoneId: milestone.id,
        planId: plan.id,
        txHash,
        network: leg.network ?? "arc",
        payee: leg.payee,
        amountUsdc: leg.amountUsdc,
        verified,
      },
    },
    {
      intentId: intent.id,
      legId: leg.id,
      txHash,
      outcome: "COMPLETED",
    },
  );
  return ok({ ...effect.value, verified, auditRecorded: audit.ok });
}
