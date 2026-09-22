/**
 * Badge SVG cache (EPIC-144, SLICE-144-4).
 *
 * Internals swapped to `CacheProvider` — badge SVGs survive restarts and
 * are shared across replicas when CACHE_ENABLED (Valkey dev / Upstash
 * prod). Default is `InMemoryCache` — identical behavior when off.
 *
 * Keys: `badge:{scope}` → `{svg, generatedAt, reportId}` JSON.
 * TTL: 24h. Tags: `domain:{scope}` (per-domain invalidation on rescan)
 * + `badge` (clear() drops all badge entries via invalidateTag).
 *
 * All methods are async — the provider contract never throws, so a
 * backend outage degrades to cache misses instead of request errors.
 */

import { InMemoryCache, type CacheProvider } from "@agentbadge/cache";

export interface CacheEntry {
  svg: string;
  generatedAt: string;
  reportId: string;
}

const KEY_PREFIX = "badge:";
const ALL_TAG = "badge";
const TTL_SEC = 24 * 60 * 60; // 24h

const key = (scope: string): string => KEY_PREFIX + scope;
const domainTag = (scope: string): string => `domain:${scope}`;

export class BadgeCache {
  private readonly provider: CacheProvider;
  /** Local scope index — backs sync `size()` (diagnostics/tests only). */
  private readonly known = new Set<string>();

  constructor(provider: CacheProvider = new InMemoryCache()) {
    this.provider = provider;
  }

  async get(scope: string): Promise<CacheEntry | undefined> {
    const entry = await this.provider.get<CacheEntry>(key(scope));
    return entry ?? undefined;
  }

  async set(scope: string, entry: CacheEntry): Promise<void> {
    this.known.add(scope);
    await this.provider.set(key(scope), entry, {
      ttlSec: TTL_SEC,
      tags: [domainTag(scope), ALL_TAG],
    });
  }

  async has(scope: string): Promise<boolean> {
    return (await this.get(scope)) !== undefined;
  }

  async invalidate(scope: string): Promise<boolean> {
    this.known.delete(scope);
    return this.provider.delete(key(scope));
  }

  async clear(): Promise<void> {
    this.known.clear();
    await this.provider.invalidateTag(ALL_TAG);
  }

  /** Entries written through this instance (diagnostic — not cross-restart). */
  size(): number {
    return this.known.size;
  }
}
