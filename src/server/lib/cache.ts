/**
 * Cache singleton (EPIC-144, SLICE-144-3).
 *
 * Lazy wrapper over `createCache()` from @agentbadge/cache.
 * Importing this module never connects — the provider is built on first
 * `getCache()` call. When `CACHE_ENABLED` is unset the config section is
 * absent and the factory returns an InMemoryCache (zero behavior change).
 *
 * `close()` is called once from the server shutdown handler — never
 * per-request (shared connection/pool).
 */

import { createCache, type CacheProvider } from "@agentbadge/cache";

import { getConfig } from "../../config/env";

let instance: CacheProvider | null = null;

export function getCache(): CacheProvider {
  if (!instance) {
    const section = getConfig().cache;
    instance = createCache({
      enabled: section?.enabled ?? false,
      backend: section?.backend,
      url: section?.url,
      token: section?.token,
    });
  }
  return instance;
}

/** Test hook — drop the cached provider so the next call rebuilds it. */
export function resetCacheForTests(): void {
  instance = null;
}
