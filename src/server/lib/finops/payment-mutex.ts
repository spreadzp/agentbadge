/**
 * EPIC-226 / SLICE-226-6 round 2 (N8) — in-process per-payment
 * mutation lock.
 *
 * The cumulative refund cap is check-then-write: two concurrent
 * requests on one payment can both read the same usage and both
 * pass. Serializing mutations per paymentId closes the race inside
 * this process. Cross-instance races still need the store-level
 * backstops (unique txHash index) or a DB advisory lock — documented
 * residual; the refund surface is single-deploy ops tooling at v1.
 */

const locks = new Map<string, Promise<unknown>>();

/** Run `fn` serialized per paymentId — later calls queue behind. */
export async function withPaymentLock<T>(
  paymentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(paymentId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(paymentId, next);
  try {
    return await next;
  } finally {
    if (locks.get(paymentId) === next) locks.delete(paymentId);
  }
}
