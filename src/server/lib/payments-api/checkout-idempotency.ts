/**
 * Idempotency helpers for `PaymentsCheckout.createPayment` — extracted
 * from `checkout.ts` (file-size lint cap).
 */
import { CheckoutError } from "./errors";

/** M-6: PENDING checkout payments expire — no unbounded zombie rows. */
export const PAYMENT_TTL_MS = 24 * 3600 * 1000;

export function defaultId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    // Nit: timestamp+Math.random ids are guessable — fail rather than
    // mint a predictable payment/attempt reference.
    throw new Error(
      "crypto.randomUUID unavailable — refusing to mint payment ids",
    );
  }
  return `${prefix}_${uuid}`;
}

/** Stable fingerprint — same convention as PaymentService so later
 *  service-side dedupe reads stay compatible. */
export function checkoutFingerprint(input: {
  reference: string;
  amount: string;
  productCode: string;
  customerId?: string;
  agentId?: string;
}): string {
  return JSON.stringify({
    reference: input.reference,
    amount: input.amount,
    currency: "USD",
    purpose: "checkout",
    productId: input.productCode,
    customerId: input.customerId ?? null,
    agentId: input.agentId ?? null,
  });
}

/** Fingerprint stored on the payment row at create time. */
export function storedFingerprint(row: { payload?: unknown }): unknown {
  return typeof row.payload === "object" && row.payload !== null
    ? (row.payload as { request?: unknown }).request
    : undefined;
}

/** H-3: an idempotency key replayed with different request fields is a
 *  conflict, not a silent replay of the stored payment — used on both
 *  the dedupe-hit path and the lost-insert-race path. */
export function assertIdempotentReplay(
  row: { payload?: unknown },
  fingerprint: string,
  idempotencyKey: string | undefined,
): void {
  if (storedFingerprint(row) !== fingerprint) {
    throw new CheckoutError(
      "idempotency_conflict",
      409,
      `idempotency key ${idempotencyKey} was used with different payment fields`,
    );
  }
}
