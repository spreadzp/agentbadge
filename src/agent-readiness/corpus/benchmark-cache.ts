/**
 * SLICE-103-4: In-memory benchmark cache with TTL.
 *
 * Stateful by design — caches benchmark computations.
 * Default TTL: 1 hour (per D6).
 */

import type { OverallBenchmark, CategoryBenchmark } from "./benchmark.schema";

export interface BenchmarkCache {
  getOverall(): OverallBenchmark | null;
  setOverall(benchmark: OverallBenchmark, ttlSeconds: number): void;
  getCategory(category: string): CategoryBenchmark | null;
  setCategory(category: string, benchmark: CategoryBenchmark, ttlSeconds: number): void;
  isExpired(key: string): boolean;
  invalidate(): void;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryBenchmarkCache implements BenchmarkCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private static readonly OVERALL_KEY = "__overall__";

  getOverall(): OverallBenchmark | null {
    const entry = this.entries.get(InMemoryBenchmarkCache.OVERALL_KEY) as CacheEntry<OverallBenchmark> | undefined;
    if (!entry || this.isExpired(InMemoryBenchmarkCache.OVERALL_KEY)) return null;
    return entry.value;
  }

  setOverall(benchmark: OverallBenchmark, ttlSeconds: number): void {
    this.entries.set(InMemoryBenchmarkCache.OVERALL_KEY, {
      value: benchmark,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  getCategory(category: string): CategoryBenchmark | null {
    const key = `category:${category}`;
    const entry = this.entries.get(key) as CacheEntry<CategoryBenchmark> | undefined;
    if (!entry || this.isExpired(key)) return null;
    return entry.value;
  }

  setCategory(category: string, benchmark: CategoryBenchmark, ttlSeconds: number): void {
    const key = `category:${category}`;
    this.entries.set(key, {
      value: benchmark,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  isExpired(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return true;
    return Date.now() >= entry.expiresAt;
  }

  invalidate(): void {
    this.entries.clear();
  }
}
