/**
 * SLICE-234-3: request-budget guards for expensive digest routes.
 *
 * Three cheap protections around a pipeline that can legitimately take
 * seconds against a 120k-row event table:
 *  - in-flight dedupe: concurrent callers of the same key share ONE
 *    compute promise instead of running the pipeline N times
 *  - short-TTL cache: identical window within `ttlMs` replays the
 *    stored response (ops metric — minute staleness is acceptable)
 *  - `withTimeout` race: bounds downstream hangs (TG API outage) and
 *    the overall handler budget — callers produce their own partial
 *    response rather than leaving the client to a proxy timeout.
 */

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Rejects with `timeout after Nms` unless `p` settles first. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error(`timeout after ${ms}ms`);
    }),
  ]);
}

export type CacheState = "hit" | "miss" | "inflight";

export class KeyedDedupeCache<T> {
  private entries = new Map<string, { at: number; res: T }>();
  private inflight = new Map<string, Promise<T>>();

  constructor(
    private ttlMs: number = 60_000,
    private now: () => number = () => Date.now(),
  ) {}

  /**
   * Returns the cached value (hit), shares the in-flight compute
   * (inflight), or runs `compute` and stores its result (miss).
   * A rejected compute propagates to every sharer — callers map it to
   * their own error response.
   */
  async get(
    key: string,
    compute: () => Promise<T>,
  ): Promise<{ res: T; state: CacheState }> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) {
      return { res: hit.res, state: "hit" };
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return { res: await pending, state: "inflight" };
    }
    const p = compute();
    this.inflight.set(key, p);
    try {
      const res = await p;
      this.entries.set(key, { at: this.now(), res });
      return { res, state: "miss" };
    } finally {
      this.inflight.delete(key);
    }
  }
}
