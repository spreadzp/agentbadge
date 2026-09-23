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
  constructor(private readonly cache: CacheProvider) {}

  async claim(txHash: string): Promise<boolean> {
    const n = await this.cache.incr(`arc:tx:${txHash.toLowerCase()}`);
    return n === 1;
  }
}
