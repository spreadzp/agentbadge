import { MemoryStore } from "../../middleware/rate-limit";

/**
 * EPIC-252 (SLICE-252-2/7): submit limiter lanes — extracted from
 * intake.ts for the file-size guard (SLICE-233-3). Re-exported from
 * intake.ts so existing import sites keep working.
 *
 * The in-handler submit limiter (agentId|fpHash key) runs AFTER the QA
 * fast-path + idempotent replay so retries never consume quota.
 */

const LANE_MAX_ENTRIES = 10_000;

/** Fixed-window submit limiter — key is `agentId ?? fpHash`. Entries
 *  are swept periodically and evicted past LANE_MAX_ENTRIES so a
 *  rotation flood can't grow the map forever (audit H-2). */
export function createSubmitLimiter(opts: {
  windowMs: number;
  max: number;
  now?: () => number;
}): {
  check(key: string): { retryAfterSec: number } | null;
  /** Decrement a consumed slot — used when a post-lane step fails
   *  so an honest retry isn't punished for our 5xx (re-audit N-1). */
  refund(key: string): void;
} {
  const store = new MemoryStore();
  const now = opts.now ?? (() => Date.now());
  let lastSweep = now();
  return {
    check(key) {
      const t = now();
      if (t - lastSweep >= opts.windowMs) {
        store.sweep(t);
        lastSweep = t;
      }
      if (store.size() > LANE_MAX_ENTRIES) {
        store.sweep(t);
        const over = store.size() - LANE_MAX_ENTRIES;
        if (over > 0) store.evictOldest?.(over);
      }
      let e = store.get(key);
      if (!e || e.resetAt <= t) {
        e = { count: 0, resetAt: t + opts.windowMs };
      }
      e.count += 1;
      store.set(key, e);
      if (e.count > opts.max) {
        return {
          retryAfterSec: Math.max(1, Math.ceil((e.resetAt - t) / 1000)),
        };
      }
      return null;
    },
    refund(key) {
      const e = store.get(key);
      if (!e) return;
      e.count = Math.max(0, e.count - 1);
      if (e.count === 0) store.delete(key);
      else store.set(key, e);
    },
  };
}

export type SubmitLanes = ReturnType<typeof createSubmitLanes>;

/**
 * Dual-lane submit limiter (SLICE-252-7 landmine): the hard lane keys on
 * `agentId ?? fpHash`; anonymous callers ALSO face an IP-less soft lane
 * keyed on `softFpHash` — rotating IPs keeps the same soft hash, so
 * IP-hops can't mint fresh lanes. Verified agents skip the soft lane
 * (their identity is already bounded by agentId).
 */
export function createSubmitLanes(opts: {
  windowMs: number;
  max: number;
  /** Anonymous soft-lane cap — default max(max*8, 8). */
  softMax?: number;
  /** Anonymous IP-only lane cap — default max(max*16, 16). */
  ipMax?: number;
  now?: () => number;
}): {
  check(
    agentId: string | null,
    fpHash: string,
    softFpHash: string,
    ipFpHash?: string | null,
  ): { retryAfterSec: number } | null;
  /** Give back the slots consumed by check() — call when a post-lane
   *  step fails so honest retries aren't double-charged (N-1). */
  refund(
    agentId: string | null,
    fpHash: string,
    softFpHash: string,
    ipFpHash?: string | null,
  ): void;
} {
  const hard = createSubmitLimiter({
    windowMs: opts.windowMs,
    max: opts.max,
    now: opts.now,
  });
  const soft = createSubmitLimiter({
    windowMs: opts.windowMs,
    max: opts.softMax ?? Math.max(opts.max * 8, 8),
    now: opts.now,
  });
  const ipLane = createSubmitLimiter({
    windowMs: opts.windowMs,
    max: opts.ipMax ?? Math.max(opts.max * 16, 16),
    now: opts.now,
  });
  return {
    check(agentId, fpHash, softFpHash, ipFpHash) {
      // Audit H-1: hard lane first — a hard-limited request must not
      // burn soft quota (a hard reject shouldn't starve the shared
      // signature bucket for everyone else on it).
      const hardKey = `hard:${agentId ?? fpHash}`;
      const limited = hard.check(hardKey);
      if (limited) return limited;
      if (agentId === null) {
        // Re-audit N-3: anonymous callers are ALSO bound to their
        // resolved IP alone — rotating identity headers mints fresh
        // fpHash/softFpHash lanes but can't escape this bucket.
        const ipKey = ipFpHash ? `ip:${ipFpHash}` : null;
        const ipLimited = ipKey ? ipLane.check(ipKey) : null;
        if (ipLimited) {
          // M-1 round-3: the rejecting lane keeps its slot, but the
          // already-taken hard slot must be returned — otherwise the
          // rejected request holds it for the full window.
          hard.refund(hardKey);
          return ipLimited;
        }
        const softLimited = soft.check(`soft:${softFpHash}`);
        if (softLimited) {
          hard.refund(hardKey);
          if (ipKey) ipLane.refund(ipKey);
          return softLimited;
        }
      }
      return null;
    },
    refund(agentId, fpHash, softFpHash, ipFpHash) {
      hard.refund(`hard:${agentId ?? fpHash}`);
      if (agentId === null) {
        if (ipFpHash) ipLane.refund(`ip:${ipFpHash}`);
        soft.refund(`soft:${softFpHash}`);
      }
    },
  };
}
