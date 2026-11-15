/**
 * Payment service — RECORD_ONLY mode only (D-224-4/D-224-15). The row is
 * auto-created NOT_PAID when the agreement is created; buyer records the
 * payment (manual), either agreement party may verify. Payment status is
 * independent of task status (spec invariant — separate store/entity).
 */
import type { CommercePaymentRow } from "@agentbadge/database";
import {
  assertDecimal,
  assertNonEmpty,
  assertSummary,
  assertWallet,
} from "../guards";
import { forbidden, type PaymentRecordInput } from "../types";
import { mustGet, transitionRow, type CommerceCtx } from "./ctx";

export interface PaymentService {
  /** Buyer-only: NOT_PAID → PAYMENT_RECORDED (manual, D-224-4). */
  record(
    actorWallet: string,
    agreementId: string,
    input?: PaymentRecordInput,
  ): Promise<CommercePaymentRow>;
  /** Provider/payee only: PAYMENT_RECORDED → PAYMENT_VERIFIED (H3). */
  verify(actorWallet: string, paymentId: string): Promise<CommercePaymentRow>;
  getByAgreement(agreementId: string): Promise<CommercePaymentRow | null>;
}

export function createPaymentService(ctx: CommerceCtx): PaymentService {
  const { stores } = ctx;

  return {
    async record(actorWallet, agreementId, input = {}) {
      const actor = assertWallet(actorWallet, "actorWallet");
      const agreement = mustGet(
        await stores.agreements.getById(agreementId),
        "agreement",
        agreementId,
      );
      if (agreement.buyerWallet !== actor) {
        throw forbidden("only the buyer can record a payment");
      }
      const payment = mustGet(
        await stores.payments.getByAgreement(agreement.id),
        "payment",
        agreement.id,
      );
      if (input.amount !== undefined && input.amount !== null) {
        assertDecimal(input.amount, "amount");
      }
      if (input.note !== undefined) {
        assertSummary(input.note, "note");
      }
      if (input.paymentId !== undefined && input.paymentId !== null) {
        assertNonEmpty(input.paymentId, "paymentId");
      }
      return transitionRow(ctx, "payment", payment, "PAYMENT_RECORDED",
        (from) =>
          stores.payments.applyStatus(payment.id, from, "PAYMENT_RECORDED", {
            recordedBy: actor,
            recordedAtMs: Date.now(),
            paymentId: input.paymentId ?? null,
            // M3: the reported amount is validated above — persist it.
            amount: input.amount ?? undefined,
            note: input.note ?? undefined,
          }),
        { actorWallet: actor },
      );
    },

    async verify(actorWallet, paymentId) {
      const actor = assertWallet(actorWallet, "actorWallet");
      const payment = mustGet(
        await stores.payments.getById(paymentId),
        "payment",
        paymentId,
      );
      const agreement = mustGet(
        await stores.agreements.getById(payment.agreementId),
        "agreement",
        payment.agreementId,
      );
      // H3: verification is the payee's acknowledgment — the payer
      // (buyer) already recorded the payment; letting the same party
      // verify would make the flag self-attested.
      if (actor !== agreement.providerWallet) {
        throw forbidden("only the provider/payee can verify a payment");
      }
      return transitionRow(ctx, "payment", payment, "PAYMENT_VERIFIED",
        (from) =>
          stores.payments.applyStatus(payment.id, from, "PAYMENT_VERIFIED", {
            verifiedBy: actor,
            verifiedAtMs: Date.now(),
          }),
        { actorWallet: actor },
      );
    },

    getByAgreement: (agreementId) =>
      stores.payments.getByAgreement(agreementId),
  };
}
