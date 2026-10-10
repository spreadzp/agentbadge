/**
 * SLICE-184-3 (EPIC-184): optional Bearer agb_ authentication.
 *
 * Enrichment-only middleware — mounts globally AFTER the existing auth
 * stack (signature-verification, x402 gates) and never rewrites their
 * decisions. Semantics:
 *   - no Authorization / non-agb Bearer  → tier "anon", passthrough
 *   - `agb_` + unknown hash              → 401 agent_key_invalid
 *   - `agb_` + revoked record            → 401 agent_key_revoked
 *   - `agb_` + active record             → c.set("agent", {…,"observer"}),
 *     c.set("agentId"), c.set("agentTier","observer") — downstream gates
 *     (bstock-freemium free bucket) pick these up for keyed limits.
 *
 * Lookups are cached in the EPIC-144 cache under `agentkey:<sha256>` TTL 60s
 * (positive results only); revocation busts the key immediately.
 * Deps resolve lazily per request — feature-off = zero-cost pass-through.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import type { CacheProvider } from "@agentbadge/cache";
import type {
  AgentRegistration,
  AgentRegistrationStore,
} from "../lib/agent-registration/store";
import { hashApiKey, isApiKeyFormat } from "../lib/agent-registration/api-keys";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";

export interface AgentKeyAuthDeps {
  store: AgentRegistrationStore;
  /** EPIC-144 cache; null = direct store lookups (still correct). */
  cache?: CacheProvider | null;
  /** Lookup cache TTL seconds (default 60). */
  ttlSec?: number;
}

export const agentKeyCacheKey = (keyHash: string) => `agentkey:${keyHash}`;

let deps: AgentKeyAuthDeps | null = null;

/**
 * H-4 (Arc Studio review): process-local revocation tombstone. When the
 * Valkey cache-bust fails, a stale "active" record would keep a revoked
 * key authenticating for up to ttlSec. The tombstone survives cache
 * outages (single-process coverage; multi-replica deployments still
 * inherit up to ttlSec of staleness — documented limitation until the
 * db backend lands).
 */
const revokedKeyHashes = new Set<string>();
const REVOKED_SET_MAX = 10_000;

/** Called once from wiring — null resets to pass-through (tests). */
export function initAgentKeyAuth(d: AgentKeyAuthDeps | null): void {
  deps = d;
  revokedKeyHashes.clear();
}

/**
 * Cache-bust a key hash after revocation — must be called by every revoke
 * path (self DELETE, admin) so cached records die instantly, not on TTL.
 */
export async function bustAgentKeyCache(keyHash: string): Promise<void> {
  if (revokedKeyHashes.size >= REVOKED_SET_MAX) revokedKeyHashes.clear();
  revokedKeyHashes.add(keyHash);
  try {
    await deps?.cache?.delete(agentKeyCacheKey(keyHash));
  } catch {
    /* cache bust is best-effort; tombstone above still blocks the key */
  }
}

async function resolve(
  d: AgentKeyAuthDeps,
  keyHash: string,
): Promise<AgentRegistration | undefined> {
  const ck = agentKeyCacheKey(keyHash);
  // Tombstone wins over any cached "active" snapshot (H-4) — the store
  // is authoritative and will return the revoked record.
  if (!revokedKeyHashes.has(keyHash) && d.cache) {
    try {
      const cached = await d.cache.get<AgentRegistration>(ck);
      // Only honor cache entries that are still terminal-safe: a cached
      // revoked record is fine (revocation is irreversible); a cached
      // active record is only trusted when no tombstone exists.
      if (cached) return cached;
    } catch {
      /* fall through to store */
    }
  }
  const rec = await d.store.byKeyHash(keyHash);
  if (rec && d.cache) {
    try {
      await d.cache.set(ck, rec, { ttlSec: d.ttlSec ?? 60 });
    } catch {
      /* best-effort */
    }
  }
  return rec;
}

export function agentKeyAuth(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    c.set("agentTier", "anon");
    const header = c.req.header("authorization");
    const key = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : undefined;
    // Not our credential shape → leave the request to other auth paths.
    if (!key || !isApiKeyFormat(key) || !deps) return next();

    const rec = await resolve(deps, hashApiKey(key));
    if (!rec) {
      return errorResponse(
        c,
        401,
        ErrorCodes.AGENT_KEY_INVALID,
        "unknown api key",
        { hint: "Register via POST /api/v1/agents/register for a new key" },
      );
    }
    if (rec.status !== "active") {
      return errorResponse(c, 401, ErrorCodes.AGENT_KEY_REVOKED, "api key revoked");
    }
    c.set("agent", { agentId: rec.agentId, tier: rec.tier, name: rec.name });
    c.set("agentId", rec.agentId);
    c.set("agentTier", "observer");
    return next();
  };
}
