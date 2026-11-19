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
import { checkMilestoneInputs } from "../../settlement/invariants.js";
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
  forbidden,
  type OfferSubmitInput,
} from "../types";
import { acceptOffer } from "./offer-accept";
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
        // M-5: provider-authored milestone terms validate at intake —
        // a bad vector would brick every downstream plan create +
        // milestone-bound review (the accept-side check is the
        // backstop; rejecting here lets the provider resubmit).
        const offeredMs =
          input.payload && typeof input.payload === "object"
            ? (input.payload as Record<string, unknown>)["milestones"]
            : undefined;
        if (offeredMs !== undefined) {
          const bad = checkMilestoneInputs(
            Array.isArray(offeredMs) ? offeredMs : [],
            price,
          );
          if (!Array.isArray(offeredMs) || bad) {
            throw new CommerceError(
              "GUARD_REJECTED",
              `payload.milestones invalid: ${!Array.isArray(offeredMs) ? "must be an array" : (bad && !bad.ok ? bad.error.message : "unknown")}`,
              400,
              { taskId: task.id },
            );
          }
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

    accept: (actorWallet, offerId) =>
      acceptOffer(ctx, actorWallet, offerId),

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
