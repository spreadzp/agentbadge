/**
 * Snapshot cache (EPIC-144, SLICE-144-5).
 *
 * Two layers:
 * - L1: per-scan in-process Map (LRU + TTL) — dedupes fetches inside one
 *   scan, always present unless `noCache`.
 * - L2: optional shared `CacheProvider` (Valkey/Upstash when CACHE_ENABLED)
 *   — cross-scan persistence under `res:{domain}:{resource}` with
 *   per-resource TTL and `domain:{domain}` tag (rescan → invalidateTag).
 *
 * All read/write methods are async — the provider contract never throws,
 * so a backend outage degrades to L1-only behavior (cache misses).
 */

import { logger } from "@agentbadge/passport";
import type { CacheProvider } from "@agentbadge/cache";

import type { ResponseSnapshot } from "./snapshot";

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
}

interface CacheEntry {
  snapshot: ResponseSnapshot;
  expiresAt: number;
  lastAccessed: number;
}

// ── Per-resource TTL policy (seconds) — tunable via env later ──

const TTL_24H = 86_400;
const TTL_6H = 21_600;
const TTL_1H = 3_600;

/**
 * robots.txt / llms.txt / sitemap & policy files: 24h.
 * API descriptors (openapi.json et al): 6h.
 * HTML pages & everything else: 1h (default).
 */
const RESOURCE_TTL_SEC: Record<string, number> = {
  robots: TTL_24H,
  sitemap: TTL_24H,
  llms: TTL_24H,
  llms_full: TTL_24H,
  agents_txt: TTL_24H,
  ai_sitemap: TTL_24H,
  llm_policy: TTL_24H,
  openapi: TTL_6H,
  openapi_standard: TTL_6H,
  api_catalog: TTL_6H,
  agent_card: TTL_6H,
  skill_json: TTL_6H,
  mcp: TTL_6H,
  webmcp: TTL_6H,
  oauth_authorization_server: TTL_6H,
  oauth_protected_resource: TTL_6H,
};

const DEFAULT_TTL_SEC = TTL_1H;

/** `https://example.com/robots` → `{ domain: "example.com", resource: "robots" }` */
function splitCacheKey(url: string): { domain: string; resource: string } {
  try {
    const u = new URL(url);
    const resource = u.pathname.replace(/^\//, "") || "root";
    return { domain: u.hostname.toLowerCase(), resource };
  } catch {
    return { domain: "unknown", resource: url };
  }
}

const sharedKey = (domain: string, resource: string): string =>
  `res:${domain}:${resource}`;

export class SnapshotCache {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private readonly ttl: number;
  private readonly maxSize: number;
  private readonly shared: CacheProvider | null;

  constructor(
    opts: { ttl?: number; maxSize?: number } = {},
    shared?: CacheProvider,
  ) {
    this.ttl = opts.ttl ?? 300_000;
    this.maxSize = opts.maxSize ?? 1000;
    this.shared = shared ?? null;
  }

  /** L1 → L2 lookup. Miss on both → null. */
  async get(url: string): Promise<ResponseSnapshot | null> {
    const key = normalizeUrl(url);
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt >= Date.now()) {
      entry.lastAccessed = Date.now();
      this.hits++;
      this.log("hit", url, "l1");
      return entry.snapshot;
    }
    if (entry) this.entries.delete(key);

    if (this.shared) {
      const { domain, resource } = splitCacheKey(url);
      const snapshot = await this.shared.get<ResponseSnapshot>(
        sharedKey(domain, resource),
      );
      if (snapshot) {
        this.hits++;
        this.log("hit", url, "l2");
        this.setLocal(key, snapshot);
        return snapshot;
      }
    }

    this.misses++;
    this.log("miss", url);
    return null;
  }

  /** Write-through: L1 always, L2 with per-resource TTL + domain tag. */
  async set(
    url: string,
    snapshot: ResponseSnapshot,
    resource?: string,
  ): Promise<void> {
    const key = normalizeUrl(url);
    this.setLocal(key, snapshot);

    if (this.shared) {
      const { domain, resource: parsed } = splitCacheKey(url);
      const res = resource ?? parsed;
      await this.shared.set(sharedKey(domain, res), snapshot, {
        ttlSec: RESOURCE_TTL_SEC[res] ?? DEFAULT_TTL_SEC,
        tags: [`domain:${domain}`],
      });
    }
  }

  async has(url: string): Promise<boolean> {
    return (await this.get(url)) !== null;
  }

  async invalidate(url?: string): Promise<void> {
    if (url) {
      const key = normalizeUrl(url);
      this.entries.delete(key);
      if (this.shared) {
        const { domain, resource } = splitCacheKey(url);
        await this.shared.delete(sharedKey(domain, resource));
      }
    } else {
      this.entries.clear();
      // L2 has no "clear all" — domain-scoped invalidation goes through
      // invalidateTag("domain:{d}") at rescan (see lib/cache.ts).
    }
  }

  stats(): CacheStats {
    return { size: this.entries.size, hits: this.hits, misses: this.misses };
  }

  private setLocal(key: string, snapshot: ResponseSnapshot): void {
    if (this.entries.size >= this.maxSize) {
      this.evictLRU();
    }
    this.entries.set(key, {
      snapshot,
      expiresAt: Date.now() + this.ttl,
      lastAccessed: Date.now(),
    });
  }

  private log(
    event: "hit" | "miss",
    url: string,
    layer?: "l1" | "l2",
  ): void {
    const { domain, resource } = splitCacheKey(url);
    logger.debug("scanner.cache", { event, resource, domain, layer });
  }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldest = key;
      }
    }
    if (oldest) this.entries.delete(oldest);
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const port = (u.protocol === "https:" && u.port === "443") ||
                 (u.protocol === "http:" && u.port === "80") ? "" : u.port;
    const path = u.pathname.replace(/\/$/, "") || "/";
    return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${port ? ":" + port : ""}${path}${u.search}`;
  } catch {
    return url.toLowerCase();
  }
}
