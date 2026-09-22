/**
 * Cache-backed rate-limit store (EPIC-144, SLICE-144-3).
 *
 * Wraps a `CacheProvider` so rate-limit counters live in shared storage
 * (Valkey dev / Upstash prod) — correct across replicas and restarts.
 *
 * The sync `RateLimitStore` surface is a no-op: eviction is handled by
 * backend TTL, not local sweeps. The real work happens in async `hit()`,
 * which maps a sliding window to `INCR rl:{key}` + `EXPIRE windowSec`
 * (TTL applies on key creation — window starts at first request).
 *
 * Failure semantics: `hit()` never throws — a backend outage degrades to
 * count=0 (request passes) with a warn log, matching the cache contract.
 */

import type { CacheProvider } from "@agentbadge/cache";

import type { RateLimitEntry, RateLimitStore } from "./rate-limit";

const KEY_PREFIX = "rl:";

export class CacheRateLimitStore implements RateLimitStore {
  constructor(private readonly cache: CacheProvider) {}

  /**
   * Atomic increment for one window. `windowMs` becomes the key TTL —
   * applied only when the key is created (INCR + EXPIRE pattern).
   * `resetAt` is an upper-bound estimate (now + window); the real expiry
   * may be earlier for keys created mid-window.
   */
  async hit(key: string, windowMs: number): Promise<RateLimitEntry> {
    const now = Date.now();
    try {
      const count = await this.cache.incr(
        KEY_PREFIX + key,
        Math.ceil(windowMs / 1000),
      );
      return { count, resetAt: now + windowMs };
    } catch (err) {
      // Defensive: CacheProvider contract already swallows backend errors,
      // but a non-conforming provider must not break the request path.
      console.warn("[rate-limit] cache hit failed, allowing request:", err);
      return { count: 0, resetAt: now + windowMs };
    }
  }

  // ── Sync surface — no-ops, TTL handles eviction ──────────

  get(_key: string): RateLimitEntry | undefined {
    return undefined;
  }

  set(_key: string, _entry: RateLimitEntry): void {}

  delete(_key: string): void {}

  sweep(_now: number): void {}

  size(): number {
    return 0;
  }
}
