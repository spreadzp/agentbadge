/**
 * EPIC-227 / SLICE-227-4 — settlement memo anchoring (D-227-8, opt-in).
 *
 * Once every milestone is terminal (RELEASED/CANCELLED) with ≥1
 * RELEASED, a participant or admin may request a memo anchor for the
 * agreement's receiptHash:
 *
 *   POST anchor → SettlementAnchor PENDING (receiptRef = agreementRef,
 *   unique → idempotent) → drain ships one memo tx on Arc
 *     memo(target, "0x", memoIdFor("settlement", receiptRef), receiptHash)
 *   → markAnchored(txHash) — a REAL hash from the send seam, never
 *     fabricated — or markAttempt with the error for retry.
 *
 * The SettlementAnchor row IS the durable outbox — PENDING survives
 * restarts and drains retry; ANCHORED is terminal. Follows the 172
 * (EaaS verdict anchor + chain flush) precedent: SendAnchorFn seam,
 * bounded attempts, honest status.
 */
import { encodeFunctionData } from "viem";
import type { Hex } from "viem";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";
import type { SettlementAnchorRow } from "@agentbadge/database";

import type { SendAnchorFn } from "../../eaas/anchor.js";
import { buildReceiptPublic } from "../receipt.js";
import { fail, ok, type SettlementResult } from "../types.js";
import { isParticipant } from "../invariants.js";
import { newAnchorId, type SettlementCtx } from "./ctx.js";

export interface AnchorRequestDeps {
  /** Receipt signer address — part of the hash-bound public body. */
  signerAddress: string;
  chainId: number;
}

/** Request the memo anchor for a fully-terminal plan. Idempotent. */
export async function requestReceiptAnchor(
  ctx: SettlementCtx,
  agreementRef: string,
  actorWallet: string,
  deps: AnchorRequestDeps,
  opts?: { admin?: boolean },
): Promise<
  SettlementResult<{ anchor: SettlementAnchorRow; duplicate: boolean }>
> {
  const plan = await ctx.db.settlement.plans.getByAgreement(agreementRef);
  if (!plan) {
    return fail("NOT_FOUND", `settlement plan not found: ${agreementRef}`);
  }
  if (
    !opts?.admin &&
    !isParticipant(actorWallet, plan.buyerWallet, plan.providerWallet)
  ) {
    return fail(
      "FORBIDDEN",
      "only the agreement buyer or provider may request its anchor",
    );
  }
  const milestones = await ctx.db.settlement.milestones.listByPlan(plan.id);
  const released = milestones.filter((m) => m.status === "RELEASED").length;
  const terminal = milestones.every((m) =>
    ["RELEASED", "CANCELLED"].includes(m.status),
  );
  if (!terminal || released === 0) {
    return fail(
      "INVALID_STATE",
      "anchor requires every milestone terminal with at least one RELEASED",
    );
  }

  // Dedupe first — one anchor per agreement (receiptRef unique).
  const existing = await ctx.db.settlement.anchors.getByReceiptRef(
    plan.agreementRef,
  );
  if (existing) {
    return ok({ anchor: existing, duplicate: true });
  }

  const built = await buildReceiptPublic(ctx, agreementRef, {
    signerAddress: deps.signerAddress,
    chainId: deps.chainId,
  });
  if (!built.ok) return built as SettlementResult<never>;

  const anchor = await ctx.db.settlement.anchors.create({
    id: newAnchorId(),
    receiptRef: plan.agreementRef,
    receiptHash: built.value.receiptHash,
    chainId: String(deps.chainId),
    status: "PENDING",
    payload: {
      planId: plan.id,
      memoId: memoIdFor("settlement", plan.agreementRef),
      signer: deps.signerAddress,
    },
  });
  if (!anchor) {
    // Lost the unique race — surface the winner (same as plan dedupe).
    const winner = await ctx.db.settlement.anchors.getByReceiptRef(
      plan.agreementRef,
    );
    if (winner) return ok({ anchor: winner, duplicate: true });
    return fail("PROVIDER_ERROR", "anchor insert conflicted");
  }
  await ctx.emit.emit({
    entityType: "settlement_anchor",
    entityId: anchor.id,
    eventType: "anchor.requested",
    actorWallet,
    payload: { agreementRef: plan.agreementRef },
  });
  return ok({ anchor, duplicate: false });
}

export interface AnchorDrainDeps {
  /** Memo contract address (ARC memo — venue network contracts). */
  memo: `0x${string}`;
  /** Anchor target — the sender EOA (self-anchor, EaaS precedent). */
  selfAddress: `0x${string}`;
  /** Send seam — production wires mkEoaSend; tests inject a stub. */
  send: SendAnchorFn;
  /** Total attempts before the row flips FAILED. Default 3. */
  retries?: number;
}

// R3 nit: the anchor store has no claim CAS — a module-scoped guard
// serializes drains in-process (the realistic double-send window:
// route-triggered fire-and-forget vs a concurrent request). Cross-
// process drains would still race — the memo write is idempotent
// (same receiptRef → same memo args) so the worst case is a duplicate
// memo tx, never a corrupted anchor row.
let drainInFlight = false;

/**
 * One drain pass over PENDING anchors. Each send resolves to a real
 * txHash → ANCHORED; a throw → markAttempt (FAILED at retry cap).
 * Returns the rows touched, newest first — callers may ignore it.
 */
export async function drainSettlementAnchors(
  ctx: SettlementCtx,
  deps: AnchorDrainDeps,
): Promise<{ anchored: number; attempted: number }> {
  if (drainInFlight) return { anchored: 0, attempted: 0 };
  drainInFlight = true;
  try {
    return await drainPass(ctx, deps);
  } finally {
    drainInFlight = false;
  }
}

async function drainPass(
  ctx: SettlementCtx,
  deps: AnchorDrainDeps,
): Promise<{ anchored: number; attempted: number }> {
  const pending = await ctx.db.settlement.anchors.list({ status: "PENDING" });
  const maxAttempts = deps.retries ?? 3;
  let anchored = 0;
  let attempted = 0;
  for (const row of pending) {
    try {
      const { txHash } = await deps.send({
        to: deps.memo,
        data: encodeFunctionData({
          abi: MEMO_ABI,
          functionName: "memo",
          args: [
            deps.selfAddress,
            "0x",
            memoIdFor("settlement", row.receiptRef),
            row.receiptHash as Hex,
          ],
        }),
      });
      await ctx.db.settlement.anchors.markAnchored(
        row.id,
        txHash,
        Date.now(),
      );
      anchored += 1;
      await ctx.emit.emit({
        entityType: "settlement_anchor",
        entityId: row.id,
        eventType: "anchor.anchored",
        actorWallet: "system",
        payload: { txHash },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const attempts = row.attempts + 1;
      await ctx.db.settlement.anchors.markAttempt(
        row.id,
        msg,
        attempts >= maxAttempts,
      );
      attempted += 1;
    }
  }
  return { anchored, attempted };
}
