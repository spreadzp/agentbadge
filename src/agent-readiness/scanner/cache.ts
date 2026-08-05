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

export class SnapshotCache {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(opts: { ttl?: number; maxSize?: number } = {}) {
    this.ttl = opts.ttl ?? 300_000;
    this.maxSize = opts.maxSize ?? 1000;
  }

  get(url: string): ResponseSnapshot | null {
    const key = normalizeUrl(url);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      this.misses++;
      if (entry) this.entries.delete(key);
      return null;
    }
    this.hits++;
    entry.lastAccessed = Date.now();
    return entry.snapshot;
  }

  set(url: string, snapshot: ResponseSnapshot): void {
    const key = normalizeUrl(url);
    if (this.entries.size >= this.maxSize) {
      this.evictLRU();
    }
    this.entries.set(key, {
      snapshot,
      expiresAt: Date.now() + this.ttl,
      lastAccessed: Date.now(),
    });
  }

  has(url: string): boolean {
    const key = normalizeUrl(url);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      return false;
    }
    return true;
  }

  invalidate(url?: string): void {
    if (url) {
      this.entries.delete(normalizeUrl(url));
    } else {
      this.entries.clear();
    }
  }

  stats(): CacheStats {
    return { size: this.entries.size, hits: this.hits, misses: this.misses };
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
