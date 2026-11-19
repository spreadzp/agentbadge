/**
 * EPIC-226 / SLICE-226-6 round-3 — shared provider-call utilities
 * (split out of stripe-refunds.ts for the 300-line arch cap; reused
 * by refund-completion.ts for the verifier call).
 *
 * L-2: every provider call under the per-payment mutex must be
 * time-bounded — a hung RPC/HTTP call otherwise pins the payment
 * lock for the life of the process and queues every later mutation.
 */

/** Default provider timeout under the payment lock. */
export const PROVIDER_TIMEOUT_MS = 25_000;

/** Rejects with a timeout error after `ms`; clears the timer on
 *  settle so the event loop is not held. */
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        t = setTimeout(
          () => rej(new Error(`provider call timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * M-6 + N4-6: classify a thrown provider error — a DEFINITE rejection
 * means the refund did NOT happen and the in-flight lock may be
 * released. Whitelist, not "any 4xx": 408 (timeout) and 409
 * (idempotency-key conflict while the original still processes) are
 * ambiguous — money may still be moving, so they stay UNCERTAIN.
 * Everything else (5xx, network, no status) is ambiguous too.
 */
const DEFINITE_STATUSES = new Set([400, 401, 402, 403, 404, 429]);
export function isDefiniteProviderRejection(e: unknown): boolean {
  const status =
    (e as { statusCode?: number } | null)?.statusCode ??
    (e as { status?: number } | null)?.status;
  if (typeof status === "number") return DEFINITE_STATUSES.has(status);
  const type = (e as { type?: string } | null)?.type;
  return type === "StripeInvalidRequestError";
}

/**
 * Stripe refund reason enum — free-form ops reasons pass through to
 * Stripe only when they match the provider's vocabulary; anything
 * else stays audit-only.
 */
const STRIPE_REASONS = new Set([
  "duplicate",
  "fraudulent",
  "requested_by_customer",
]);
export const stripeReason = (reason?: string): string | undefined =>
  reason !== undefined && STRIPE_REASONS.has(reason) ? reason : undefined;
