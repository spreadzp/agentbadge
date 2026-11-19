/**
 * EPIC-227 / SLICE-227-3 — settlement receipt read projection.
 *
 * `GET /api/settlement/receipts/:agreementId` returns a deterministic
 * JSON view over the settled state: plan, ordered milestones with their
 * intents/legs, disputes and the memo-anchor row when SLICE-227-4 has
 * produced one (receiptRef = agreementRef). Ordering is by milestone
 * seq — the projection is stable for the same stored state. The signed
 * EIP-712 artifact lands in 227-4 on top of this shape.
 */
import type { SettlementCtx } from "./ctx.js";

export async function getSettlementReceipt(
  ctx: SettlementCtx,
  agreementRef: string,
) {
  const plan = await ctx.db.settlement.plans.getByAgreement(agreementRef);
  if (!plan) return null;
  const milestones = await ctx.db.settlement.milestones.listByPlan(plan.id);
  const anchor = await ctx.db.settlement.anchors.getByReceiptRef(
    plan.agreementRef,
  );
  const items = [];
  for (const m of milestones) {
    const intent = await ctx.db.settlement.payoutIntents.getByMilestone(m.id);
    const legs = intent
      ? await ctx.db.settlement.payoutLegs.listByIntent(intent.id)
      : [];
    items.push({
      id: m.id,
      milestoneId: m.milestoneId,
      seq: m.seq,
      title: m.title,
      amountUsd: m.amountUsd,
      status: m.status,
      releasePolicy: m.releasePolicy,
      intent: intent
        ? {
            id: intent.id,
            status: intent.status,
            createdAtMs: intent.createdAtMs,
            completedAtMs: intent.completedAtMs,
            completedBy: intent.completedBy,
            legs: legs.map((l) => ({
              id: l.id,
              payee: l.payee,
              amountUsdc: l.amountUsdc,
              role: l.role,
              status: l.status,
              network: l.network,
              txHash: l.txHash,
              completedAtMs: l.completedAtMs,
            })),
          }
        : null,
    });
  }
  const disputeRows = [
    ...(await ctx.db.settlement.disputes.listBySubject(
      "AGREEMENT",
      plan.agreementRef,
    )),
    ...(
      await Promise.all(
        milestones.map((m) =>
          ctx.db.settlement.disputes.listBySubject("MILESTONE", m.id),
        ),
      )
    ).flat(),
  ];
  const disputes = [...new Map(disputeRows.map((d) => [d.id, d])).values()];
  return {
    type: "settlement_projection@1",
    agreementRef: plan.agreementRef,
    plan: {
      id: plan.id,
      status: plan.status,
      currency: plan.currency,
      totalUsd: plan.totalUsd,
      buyerWallet: plan.buyerWallet,
      providerWallet: plan.providerWallet,
    },
    milestones: items,
    disputes: disputes.map((d) => ({
      id: d.id,
      subjectType: d.subjectType,
      subjectRef: d.subjectRef,
      status: d.status,
      resolution: d.resolution,
      raisedBy: d.raisedBy,
      createdAtMs: d.createdAtMs,
      resolvedAtMs: d.resolvedAtMs,
    })),
    // SLICE-227-4 fills this in — PENDING → ANCHORED with txHash.
    anchor: anchor
      ? {
          id: anchor.id,
          receiptHash: anchor.receiptHash,
          chainId: anchor.chainId,
          txHash: anchor.txHash,
          status: anchor.status,
          anchoredAtMs: anchor.anchoredAtMs,
        }
      : null,
  };
}
