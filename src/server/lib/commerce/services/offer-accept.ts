/**
 * Offer accept — buyer accepts a PENDING offer (D-224-9 single round,
 * D-227 multi-provider). Split from offer-service.ts (300-line cap).
 *
 * Atomic section: offer→ACCEPTED, Agreement ACTIVE, RECORD_ONLY
 * payment NOT_PAID, task→IN_PROGRESS; when the accept fills the
 * task's maxProviders quota the remaining PENDING offers are
 * rejected in the same tx. Post-commit (best-effort): the settlement
 * bridge auto-creates the milestone plan keyed by agreementRef =
 * agreement.id.
 */
import type {
  CommerceAgreementRow,
  CommerceOfferRow,
  CommercePaymentRow,
} from "@agentbadge/database";
import { logger } from "@agentbadge/passport/logger";
import { assertWallet, newId } from "../guards";
import { checkMilestoneInputs } from "../../settlement/invariants.js";
import {
  CommerceError,
  conflict,
  forbidden,
  guardRejected,
} from "../types";
import { mustGet, transitionRow, type CommerceCtx } from "./ctx";

export async function acceptOffer(
  ctx: CommerceCtx,
  actorWallet: string,
  offerId: string,
): Promise<{
  offer: CommerceOfferRow;
  agreement: CommerceAgreementRow;
  payment: CommercePaymentRow;
}> {
  const { stores, emit } = ctx;
  const actor = assertWallet(actorWallet, "actorWallet");
  // C1: the whole accept — offer transition, agreement, task
  // transition, payment row, sibling-offer rejection — is one
  // atomic section. All preconditions run before the first write,
  // so a failure anywhere leaves zero partial state.
  const out = await stores.atomic(async (tx) => {
    const txCtx = { ...ctx, stores: tx };
    const offer = mustGet(
      await tx.offers.getById(offerId),
      "offer",
      offerId,
    );
    const task = mustGet(
      await tx.tasks.getById(offer.taskId),
      "task",
      offer.taskId,
    );
    if (task.buyerWallet !== actor) {
      throw forbidden("only the buyer can accept an offer");
    }
    // Preconditions before any write — work must be in flight
    // (OPEN or already IN_PROGRESS under a multi-provider quota),
    // the offer PENDING, and a provider slot free (D-227).
    if (task.status !== "OPEN" && task.status !== "IN_PROGRESS") {
      throw new CommerceError(
        "INVALID_TRANSITION",
        `task is ${task.status} — offers can only be accepted while OPEN or IN_PROGRESS`,
        409,
        { taskId: task.id },
      );
    }
    if (offer.status !== "PENDING") {
      throw new CommerceError(
        "INVALID_TRANSITION",
        `offer is ${offer.status} — only PENDING offers can be accepted`,
        409,
        { offerId },
      );
    }
    const maxProviders = task.maxProviders ?? 1;
    const activeCount = await tx.agreements.countByTaskId(task.id, {
      excludeStatuses: ["CANCELLED", "COMPLETED"],
    });
    if (activeCount >= maxProviders) {
      throw conflict(
        `provider slots filled (${activeCount}/${maxProviders})`,
      );
    }

    // M-5: provider-authored milestone terms ride the offer payload —
    // validate them before any write (a bad vector would brick every
    // plan create + milestone-bound review downstream), and snapshot
    // them into the agreement so a mutable offer row can't move the
    // canonical payout contract after accept.
    const offered =
      offer.payload && typeof offer.payload === "object"
        ? (offer.payload as Record<string, unknown>)["milestones"]
        : undefined;
    if (offered !== undefined) {
      const bad = checkMilestoneInputs(
        Array.isArray(offered) ? offered : [],
        offer.price,
      );
      if (!Array.isArray(offered) || bad) {
        throw guardRejected(
          `offer payload.milestones invalid: ${!Array.isArray(offered) ? "must be an array" : (bad && !bad.ok ? bad.error.message : "unknown")}`,
          { offerId },
        );
      }
    }

    const accepted = await transitionRow(
      txCtx, "offer", offer, "ACCEPTED",
      (from) => tx.offers.applyStatus(offer.id, from, "ACCEPTED"),
      { actorWallet: actor },
    );

    // one agreement per offer; ≤maxProviders per task (D-227)
    const agreement = await tx.agreements.create({
      id: newId("ag"),
      taskId: task.id,
      offerId: offer.id,
      buyerWallet: task.buyerWallet,
      providerWallet: offer.providerWallet,
      agreedAmount: offer.price,
      currency: offer.currency,
      acceptanceCriteria: task.requirements ?? null,
      status: "ACTIVE",
      payload:
        Array.isArray(offered) && offered.length > 0
          ? { milestones: offered }
          : {},
    });
    if (!agreement) {
      throw conflict("agreement already exists for this task/offer");
    }
    await emit.emit({
      entityType: "agreement",
      entityId: agreement.id,
      eventType: "agreement.created",
      actorWallet: actor,
      payload: { taskId: task.id, offerId: offer.id },
    });
    // First accept marks work started; further accepts while the
    // quota is open keep the task IN_PROGRESS.
    if (task.status === "OPEN") {
      await transitionRow(txCtx, "task", task, "IN_PROGRESS", (from) =>
        tx.tasks.applyStatus(task.id, from, "IN_PROGRESS"),
      );
    }
    const payment = await tx.payments.create({
      id: newId("pm"),
      agreementId: agreement.id,
      mode: "RECORD_ONLY",
      status: "NOT_PAID",
      amount: agreement.agreedAmount,
      currency: agreement.currency ?? "USD",
      payload: {},
    });
    if (!payment) throw conflict("payment row exists for agreement");
    await emit.emit({
      entityType: "payment",
      entityId: payment.id,
      eventType: "payment.created",
      actorWallet: actor,
      payload: { agreementId: agreement.id, status: "NOT_PAID" },
    });
    // Quota just filled → close the round: every other still-PENDING
    // offer is rejected — no accepted-offer state can coexist with
    // a live sibling that could be accepted past maxProviders.
    if (activeCount + 1 >= maxProviders) {
      for (const sib of await tx.offers.listByTask(task.id)) {
        if (sib.id === offer.id || sib.status !== "PENDING") continue;
        await transitionRow(txCtx, "offer", sib, "REJECTED", (from) =>
          tx.offers.applyStatus(sib.id, from, "REJECTED"),
          {
            actorWallet: actor,
            payload: { reason: "sibling_offer_accepted", acceptedOfferId: offer.id },
          },
        );
      }
    }
    return { offer: accepted, agreement, payment };
  });
  // SLICE-227-5: post-commit — every accepted agreement gets its
  // milestone plan (one per agreementRef; idempotent). Draft
  // milestones come from offer terms when declared, else a single
  // full-amount milestone. Best-effort seam: failure logs and the
  // plan is ensured lazily on the milestone paths instead.
  if (ctx.settlement) {
    try {
      const p = out.offer.payload;
      const ms =
        p && typeof p === "object" && !Array.isArray(p)
          ? (p as Record<string, unknown>)["milestones"]
          : undefined;
      await ctx.settlement.ensurePlan({
        agreementId: out.agreement.id,
        buyerWallet: out.agreement.buyerWallet,
        providerWallet: out.agreement.providerWallet,
        agreedAmount: out.agreement.agreedAmount,
        // plan currency is the settlement rail (USDC) — commerce's
        // "USD" is the display unit; amounts are 1:1 by convention.
        currency: "USDC",
        milestones: Array.isArray(ms) ? ms : null,
      });
    } catch (err) {
      logger.warn("settlement ensurePlan failed (lazy retry)", {
        agreementId: out.agreement.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
