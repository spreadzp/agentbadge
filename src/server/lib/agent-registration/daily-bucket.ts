/**
 * SLICE-184-1 (EPIC-184): daily-UTC rate buckets for registration.
 * Extracted from register.ts for the 300-line cap (lint max-lines).
 *
 * `<prefix>:<tag>:<day>` — shared across replicas, resets at UTC day
 * boundary (48h TTL covers the trailing edge). In-memory fallback when
 * no cache — an ops-level throttle, not a hard security boundary
 * (honest-zero reputation is the real disincentive).
 * Fail-open on backend error (incr returns 0 → allowed), per EPIC-144
 * passthrough contract — except `strict` buckets (sponcap), which are a
 * financial boundary and fail CLOSED (Arc Studio review H-1).
 */
import type { CacheProvider } from "@agentbadge/cache";

export function createDailyBucket(
  prefix: string,
  limit: number,
  cache?: CacheProvider | null,
  opts?: { strict?: boolean },
) {
  const strict = opts?.strict ?? false;
  const fallback = new Map<string, number>();
  const TTL_SEC = 48 * 3600;
  const day = () => new Date().toISOString().slice(0, 10); // UTC yyyy-mm-dd
  return {
    async allow(tag: string): Promise<boolean> {
      const key = `${prefix}:${tag}:${day()}`;
      if (!cache) {
        const n = (fallback.get(key) ?? 0) + 1;
        fallback.set(key, n);
        return n <= limit;
      }
      const n = await cache.incr(key, TTL_SEC).catch(() => (strict ? -1 : 0));
      // backend down → fail-open for regcap, fail-CLOSED for the
      // financial sponcap bucket (Arc Studio review H-1).
      if (n === 0) return true;
      if (n < 0) return false;
      return n <= limit;
    },
    /**
     * Compensate a reservation whose follow-up work failed (e.g. mint
     * threw after the counter was incremented). Best-effort: cache has
     * no atomic decr, so a concurrent allow() can overwrite — a miss
     * only ever makes the budget tighter, never looser.
     */
    async release(tag: string): Promise<void> {
      const key = `${prefix}:${tag}:${day()}`;
      if (!cache) {
        fallback.set(key, Math.max(0, (fallback.get(key) ?? 0) - 1));
        return;
      }
      try {
        const n = await cache.get<number>(key);
        if (typeof n === "number" && n > 0) {
          await cache.set(key, n - 1, { ttlSec: TTL_SEC });
        }
      } catch {
        /* best-effort compensation */
      }
    },
  };
}

/** Per-IP daily registration cap (sybil guard, D-184-7): regcap:<ip>:<day>. */
export function createDailyLimiter(limit: number, cache?: CacheProvider | null) {
  return createDailyBucket("regcap", limit, cache);
}
