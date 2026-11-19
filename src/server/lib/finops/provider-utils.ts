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
 * M-6: classify a thrown provider error — a definite rejection (HTTP
 * 4xx / StripeInvalidRequestError) means the refund did NOT happen
 * and the in-flight lock may be released; anything else (timeout,
 * 5xx, network) is ambiguous — the provider may still have
 * processed it.
 */
export function isDefiniteProviderRejection(e: unknown): boolean {
  const status =
    (e as { statusCode?: number } | null)?.statusCode ??
    (e as { status?: number } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return true;
  }
  const type = (e as { type?: string } | null)?.type;
  return type === "StripeInvalidRequestError";
}
