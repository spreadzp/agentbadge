import type { Context } from "hono";

import { resolveClientIp } from "../../middleware/rate-limit";
import {
  createTieredLimiter,
  type TieredLimiter,
} from "../../routes/agent-interaction/rate-limits";

/**
 * EPIC-229 (SLICE-229-5) limiter config — extracted to lib for
 * SLICE-233-5 so the MCP tool adapter rides the SAME bucket as the
 * REST route (one budget across transports, submit-lanes precedent).
 */

export const SEARCH_TIER_LIMITS = { ANON: 10, API_KEY: 60, DID: 120 } as const;
const SEARCH_GLOBAL_MAX = SEARCH_TIER_LIMITS.DID * 10;

export function knowledgeSearchTier(
  c: Context,
): keyof typeof SEARCH_TIER_LIMITS {
  if (c.get("verifiedDid")) return "DID";
  return c.get("agentId") ? "API_KEY" : "ANON";
}

export function knowledgeSearchLimiterKey(c: Context): string {
  const did = c.get("verifiedDid");
  if (typeof did === "string" && did.length > 0) return `did:${did}`;
  const agentId = c.get("agentId");
  if (typeof agentId === "string" && agentId.length > 0) {
    return `key:${agentId}`;
  }
  // Arc R1 M13: one shared anon bucket for search+ask — path-suffixed
  // keys gave an anonymous caller 2x the intended budget (10/min on
  // EACH surface). Identity-keyed tiers stay per-actor anyway.
  return `ip:${resolveClientIp(c)}:knowledge`;
}

let shared: TieredLimiter | undefined;

/** Single process-wide bucket — REST route and MCP tool must not
 *  each grant a full budget (transport switch = double-dip). */
export function getSharedKnowledgeSearchLimiter(): TieredLimiter {
  return (shared ??= createTieredLimiter({
    limits: SEARCH_TIER_LIMITS,
    globalKey: "g:knowledge-search",
    globalMax: SEARCH_GLOBAL_MAX,
    // Arc R1 M13: anon rotation-flood can't starve DID/API_KEY
    // tiers out of the shared global bucket (228 H1 class).
    tierGroups: {
      ANON: { key: "g:knowledge-search:anon", max: SEARCH_GLOBAL_MAX / 10 },
    },
  }));
}
