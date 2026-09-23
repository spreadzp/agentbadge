/**
 * Single-use nonce store for DID-auth challenges (EPIC-82 SLICE-82-1,
 * cache-backed since EPIC-145 SLICE-145-5).
 *
 * Backed by the shared CacheProvider: issue → set(nonce:{n}, ttl),
 * consume → get(issued) + incr(nonce:consumed:{n}) — the atomic INCR makes
 * single-use hold across replicas. CACHE_ENABLED=false → InMemoryCache
 * (per-process, same semantics). The Set fallback only engages when the
 * provider itself can't be constructed (getCache throws).
 */

import { randomBytes } from "node:crypto";
import { tryGetCache } from "../lib/cache";

export class NonceStore {
  // Fallback Sets — used only when the cache provider itself is
  // unavailable (getCache throws). CACHE_ENABLED=false still goes through
  // InMemoryCache, which is already per-process + TTL'd.
  private fallbackIssued = new Set<string>();
  private fallbackConsumed = new Set<string>();
  private ttlMs: number;

  constructor(ttlMs = 600_000) {
    this.ttlMs = ttlMs;
  }

  private get ttlSec(): number {
    return Math.max(1, Math.ceil(this.ttlMs / 1000));
  }

  async issue(): Promise<string> {
    const nonce = randomBytes(16).toString("hex");
    const cache = tryGetCache();
    if (cache) {
      await cache.set(`nonce:${nonce}`, "1", { ttlSec: this.ttlSec });
    } else {
      this.fallbackIssued.add(nonce);
      setTimeout(() => this.fallbackIssued.delete(nonce), this.ttlMs);
    }
    return nonce;
  }

  async consume(nonce: string): Promise<boolean> {
    const cache = tryGetCache();
    if (cache) {
      const issued = await cache.get(`nonce:${nonce}`);
      if (!issued) return false;
      // Atomic single-use: INCR returns 1 only to the first consumer —
      // safe across replicas. Backend error returns 0 → reject (fail-closed).
      const n = await cache.incr(`nonce:consumed:${nonce}`, this.ttlSec);
      return n === 1;
    }
    if (!this.fallbackIssued.has(nonce)) return false;
    if (this.fallbackConsumed.has(nonce)) return false;
    this.fallbackConsumed.add(nonce);
    setTimeout(() => this.fallbackConsumed.delete(nonce), this.ttlMs);
    return true;
  }
}
