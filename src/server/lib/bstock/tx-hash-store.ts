/**
 * Cache-backed TxHashStore (SLICE-141-13 доп.).
 *
 * Atomic single-use claim via `CacheProvider.incr` — the same primitive
 * NonceStore uses. `incr("arc:tx:{hash}")` returns 1 on first claim,
 * >1 on replay. No TTL: the key persists on Upstash so a machine
 * restart does not reopen the replay window. When `CACHE_ENABLED` is
 * off, `getCache()` yields InMemoryCache — same semantics, per-process.
 */

import type { CacheProvider } from "@agentbadge/cache";
import type { TxHashStore } from "@agentbadge/circle-payments";

export class CacheTxHashStore implements TxHashStore {
  private readonly local = new Set<string>();

  constructor(private readonly cache: CacheProvider) { }

  async claim(txHash: string): Promise<boolean> {
    const key = txHash.toLowerCase();
    const n = await this.cache.incr(`arc:tx:${key}`);
    // INCR never returns 0 on success → 0 means backend unavailable.
    // Use a per-process set so payments are not rejected during an outage,
    // while replays on this instance are still blocked.
    if (n === 0) {
      if (this.local.has(key)) return false;
      this.local.add(key);
      return true;
    }
    return n === 1;
  }
}
