/**
 * Offer service — single-round offers (D-224-9): provider submits once
 * (PENDING); buyer accepts (→ Agreement auto-created ACTIVE) or rejects;
 * provider withdraws.
 */
import type {
  CommerceAgreementRow,
  CommerceOfferRow,
  CommercePaymentRow,
} from "@agentbadge/database";
import { idempotentWrite } from "../../contract-guards";
import {
  assertDecimal,
  assertIdempotencyKey,
  assertNonEmpty,
  assertSummary,
  assertWallet,
  compareDecimals,
  newId,
} from "../guards";
import {
  CommerceError,
  conflict,
  forbidden,
  type OfferSubmitInput,
} from "../types";
import { mustGet, transitionRow, type CommerceCtx } from "./ctx";

export interface OfferService {
  submit(
    actorWallet: string,
    taskId: string,
    input: OfferSubmitInput,
    idempotencyKey?: string,
    /** H1: sha256 of the signed request body — binds the dedupe entry. */
    bodyFingerprint?: string,
  ): Promise<{ offer: CommerceOfferRow; duplicate: boolean }>;
  accept(
    actorWallet: string,
    offerId: string,
  ): Promise<{
    offer: CommerceOfferRow;
    agreement: CommerceAgreementRow;
    payment: CommercePaymentRow;
  }>;
  reject(actorWallet: string, offerId: string): Promise<CommerceOfferRow>;
  withdraw(actorWallet: string, offerId: string): Promise<CommerceOfferRow>;
  listByTask(taskId: string): Promise<CommerceOfferRow[]>;
}

export function createOfferService(ctx: CommerceCtx): OfferService {
  const { stores, emit } = ctx;

  return {
    async submit(actorWallet, taskId, input, idempotencyKey, bodyFingerprint) {
      const provider = assertWallet(actorWallet, "actorWallet");
      if (idempotencyKey !== undefined) {
        assertIdempotencyKey(idempotencyKey);
        const res = await idempotentWrite(
          "commerce.offer.submit",
          idempotencyKey,
          async () => {
            const offer = await doSubmit(provider);
            return { status: 201, body: { offer } };
          },
          {
            owner: provider,
            resource: taskId,
            fingerprint: bodyFingerprint,
          },
        );
        return {
          offer: (res.body as { offer: CommerceOfferRow }).offer,
          duplicate: res.duplicate,
        };
      }
      const offer = await doSubmit(provider);
      return { offer, duplicate: false };

      async function doSubmit(provider: string): Promise<CommerceOfferRow> {
        const task = mustGet(
          await stores.tasks.getById(taskId),
          "task",
          taskId,
        );
        if (task.buyerWallet === provider) {
          throw forbidden("buyer cannot offer on own task");
        }
        // only OPEN tasks accept offers — a stale/closed task is an
        // invalid transition, not an authz violation
        if (task.status !== "OPEN") {
          throw new CommerceError(
            "INVALID_TRANSITION",
            `task is ${task.status} — offers only allowed on OPEN`,
            409,
          );
        }
        const price = assertDecimal(input.price, "price");
        const proposal = assertSummary(input.proposal, "proposal");
        if (input.eta !== undefined && input.eta !== null) {
          assertNonEmpty(input.eta, "eta");
        }
        // Currency must match the task's declared unit; a priced offer
        // above the declared budget cap is rejected up-front.
        const currency = input.currency ?? "USD";
        if (task.currency && currency !== task.currency) {
          throw new CommerceError(
            "GUARD_REJECTED",
            `offer currency ${currency} must match task currency ${task.currency}`,
            400,
            { taskId: task.id },
          );
        }
        if (task.budget && compareDecimals(price, task.budget) > 0) {
          throw new CommerceError(
            "GUARD_REJECTED",
            `price ${price} exceeds task budget ${task.budget}`,
            400,
            { taskId: task.id },
          );
        }
        const offer = await stores.offers.create({
          id: newId("of"),
          taskId: task.id,
          providerWallet: provider,
          // H5: unverified self-claim — payload only.
          providerAgentId: null,
          price,
          currency,
          eta: input.eta ?? null,
          proposal,
          status: "PENDING",
          payload: {
            ...(input.payload && typeof input.payload === "object"
              ? (input.payload as Record<string, unknown>)
              : {}),
            ...(input.providerAgentId
              ? { claimedProviderAgentId: input.providerAgentId }
              : {}),
          } as Record<string, never>,
        });
        if (!offer) throw new Error("offer id collision");
        await emit.emit({
          entityType: "offer",
          entityId: offer.id,
          eventType: "offer.submitted",
          actorWallet: provider,
          payload: { taskId: task.id, price },
        });
        return offer;
      }
    },

    async accept(actorWallet, offerId) {
      const actor = assertWallet(actorWallet, "actorWallet");
      // C1: the whole accept — offer transition, agreement, task
      // transition, payment row, sibling-offer rejection — is one
      // atomic section. All preconditions run before the first write,
      // so a failure anywhere leaves zero partial state.
      return stores.atomic(async (tx) => {
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
        // Preconditions before any write — task must be OPEN (no other
        // acceptance could have landed), offer must be PENDING, and no
        // agreement may already exist on this task.
        if (task.status !== "OPEN") {
          throw new CommerceError(
            "INVALID_TRANSITION",
            `task is ${task.status} — offers can only be accepted while OPEN`,
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
        if (await tx.agreements.getByTaskId(task.id)) {
          throw conflict("agreement already exists for this task");
        }

        const accepted = await transitionRow(
          txCtx, "offer", offer, "ACCEPTED",
          (from) => tx.offers.applyStatus(offer.id, from, "ACCEPTED"),
          { actorWallet: actor },
        );

        // single-round: exactly one agreement per task/offer
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
          payload: {},
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
        await transitionRow(txCtx, "task", task, "IN_PROGRESS", (from) =>
          tx.tasks.applyStatus(task.id, from, "IN_PROGRESS"),
        );
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
        // C1: every other still-PENDING offer on the task is rejected —
        // no accepted-offer state can coexist with a live sibling that
        // could later be accepted into a second agreement.
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
        return { offer: accepted, agreement, payment };
      });
    },

    async reject(actorWallet, offerId) {
      const actor = assertWallet(actorWallet, "actorWallet");
      const offer = mustGet(
        await stores.offers.getById(offerId), "offer", offerId);
      const task = mustGet(
        await stores.tasks.getById(offer.taskId), "task", offer.taskId);
      if (task.buyerWallet !== actor) {
        throw forbidden("only the buyer can reject an offer");
      }
      return transitionRow(ctx, "offer", offer, "REJECTED", (from) =>
        stores.offers.applyStatus(offer.id, from, "REJECTED"),
      );
    },

    async withdraw(actorWallet, offerId) {
      const actor = assertWallet(actorWallet, "actorWallet");
      const offer = mustGet(
        await stores.offers.getById(offerId), "offer", offerId);
      if (offer.providerWallet !== actor) {
        throw forbidden("only the provider can withdraw an offer");
      }
      return transitionRow(ctx, "offer", offer, "WITHDRAWN", (from) =>
        stores.offers.applyStatus(offer.id, from, "WITHDRAWN"),
      );
    },

    listByTask: (taskId) => stores.offers.listByTask(taskId),
  };
}
