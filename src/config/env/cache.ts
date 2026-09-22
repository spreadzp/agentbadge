/**
 * Cache config section (EPIC-144, SLICE-144-2).
 * Optional — only loaded when CACHE_ENABLED=true.
 * Off = InMemoryCache fallback inside @agentbadge/cache, zero behavior change.
 */

import type { CacheEnvConfig } from "./types";
import { booleanFlag, requiredString } from "./validators";

const BACKENDS = new Set(["memory", "valkey", "upstash"]);

export function loadCache(errors: string[]): CacheEnvConfig | undefined {
  if (!booleanFlag("CACHE_ENABLED")) return undefined;

  const rawBackend = process.env.CACHE_BACKEND ?? "memory";
  if (!BACKENDS.has(rawBackend)) {
    errors.push(
      `Invalid CACHE_BACKEND: expected memory|valkey|upstash, got "${rawBackend}"`,
    );
  }
  const backend = rawBackend as CacheEnvConfig["backend"];

  // Remote backends need an endpoint; Upstash additionally needs a token.
  let url: string | undefined;
  let token: string | undefined;
  if (backend === "valkey" || backend === "upstash") {
    url = requiredString("CACHE_URL", errors);
  }
  if (backend === "upstash") {
    token = requiredString("CACHE_TOKEN", errors);
  }

  return { enabled: true, backend, url, token };
}
