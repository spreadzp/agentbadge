/**
 * EPIC-226 / SLICE-226-6 round 2 (N8) + round-4 (N4-1) — in-process
 * per-payment mutation lock.
 *
 * The cumulative refund cap is check-then-write: two concurrent
 * requests on one payment can both read the same usage and both
 * pass. Serializing mutations per paymentId closes the race inside
 * this process. Cross-instance races still need the store-level
 * backstops (unique txHash index) or a DB advisory lock — documented
 * residual; the refund surface is single-deploy ops tooling at v1.
 *
 * N4-1: lock keys are SCOPED — callers pass "pay" or "tx" and the
 * real map key is `${scope}:${id}`, so a user-controlled id can
 * never alias a txHash lock key (an intentId of "tx:0x…" previously
 * self-deadlocked: the outer lock held the same key the inner wait
 * queued behind). Nested acquisition is always payment-scope first,
 * then tx-scope — a single nesting order, no ABBA.
 *
 * Queue-wait is BOUNDED (ACQUIRE_TIMEOUT_MS): a wedged holder can
 * never queue money mutations forever. Only acquisition is timed —
 * once a caller owns the slot its work runs to completion, because
 * abandoning a mid-flight refund mutation would leave exactly the
 * half-applied state the lock exists to prevent.
 */

const locks = new Map<string, Promise<unknown>>();

export type LockScope = "pay" | "tx";

const ACQUIRE_TIMEOUT_MS = 30_000;

export class LockAcquireTimeoutError extends Error {
  constructor(readonly key: string) {
    super(`lock acquisition timed out for ${key}`);
    this.name = "LockAcquireTimeoutError";
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` serialized per `${scope}:${id}` — later calls queue
 * behind the current holder. The queued caller still runs after a
 * rejected predecessor, and the map entry is dropped once the tail
 * settles. A waiter that does not acquire within ACQUIRE_TIMEOUT_MS
 * throws LockAcquireTimeoutError and its slot becomes a no-op, so
 * the queue drains past it.
 */
export async function withLock<T>(
  scope: LockScope,
  id: string,
  fn: () => Promise<T>,
  acquireTimeoutMs = ACQUIRE_TIMEOUT_MS,
): Promise<T> {
  const key = `${scope}:${id}`;
  const prev = locks.get(key) ?? Promise.resolve();
  const acquired = prev.then(
    () => true,
    () => true,
  );
  let skipped = false;
  const next = acquired.then(() =>
    skipped ? Promise.reject(new LockAcquireTimeoutError(key)) : fn(),
  );
  locks.set(key, next);
  const timedOut = await Promise.race([
    acquired.then(() => false),
    sleep(acquireTimeoutMs).then(() => true),
  ]);
  if (timedOut) {
    skipped = true;
    // Absorb the slot's eventual rejection without awaiting it —
    // `next` is still queued behind the wedged holder, so awaiting
    // would hang. The slot is a no-op: later callers chain past it.
    void next.catch(() => {});
    if (locks.get(key) === next) locks.delete(key);
    throw new LockAcquireTimeoutError(key);
  }
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
