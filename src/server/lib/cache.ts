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

/**
 * `getCache()` that never throws — returns null when config loading or
 * provider construction fails, so callers can degrade to in-memory paths.
 */
export function tryGetCache(): CacheProvider | null {
  try {
    return getCache();
  } catch {
    return null;
  }
}

/**
 * Drop all cache entries tagged `domain:{domain}` — badge SVGs and other
 * per-domain artifacts go stale the moment a rescan completes.
 * Fire-and-forget safe: the provider contract never throws.
 */
export async function invalidateDomain(domain: string): Promise<number> {
  return getCache().invalidateTag(`domain:${domain}`);
}
