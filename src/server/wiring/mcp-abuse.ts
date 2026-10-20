/**
 * MCP abuse-guard wiring (EPIC-200, SLICE-200-08, D-200-2).
 *
 * Extracted from index.ts (300-line cap). Mount AFTER agentKeyAuth so
 * agentTier/agentId are already on the context for lane selection:
 *   app.use(agentKeyAuth());
 *   wireMcpAbuseGuard(app);
 *   ...
 *   armMcpHeavyGate(circleRuntime);  // after circle payments init
 */

import type { Context, Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";
import { get as getDirectoryEntry } from "@agentbadge/passport";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";
import { getConfig } from "../../config/env";
import { getCache } from "../lib/cache";
import { mcpAbuseGuard, setMcpHeavyGate } from "../middleware/mcp-abuse-guard";
import { CacheRateLimitStore } from "../middleware/rate-limit-redis-store";
import { bazaarExtensionFor } from "../lib/service-catalog/bazaar";

/** Passport-tier RPM caps (D-200-2). Provisional doubling ladder from
 *  the keyed 120/min lane; policy review can tune or move to env later. */
export const MCP_TIER_RPM: Record<string, number> = {
  bronze: 240,
  silver: 480,
  gold: 960,
  platinum: 1920,
};

/** Trusted tier resolution: did-auth's signature-verified `verifiedDid`
 *  → directoryCache entry.tier (bronze→platinum). Falls back to
 *  agentTier from agentKeyAuth, then "anon". A self-declared DID header
 *  is never read here — unverified identity cannot elevate its lane. */
export function resolveMcpAbuseTier(c: Context): string {
  const did = c.get("verifiedDid") as string | undefined;
  if (did) {
    const tier = getDirectoryEntry(did)?.tier;
    if (tier) return tier;
  }
  return (c.get("agentTier") as string | undefined) ?? "anon";
}

/** Mounts the abuse-guard on /mcp + /mcp/* when enabled (default ON).
 *  The guard is idempotent per request, so the double-mount is cheap. */
export function wireMcpAbuseGuard(app: Hono): void {
  const mcpAbuse = getConfig().mcpAbuse;
  if (!mcpAbuse) return;
  const guard = mcpAbuseGuard({
    anonMax: mcpAbuse.anonRpm,
    keyedMax: mcpAbuse.keyedRpm,
    heavyMax: mcpAbuse.heavyRpm,
    heavyOps: mcpAbuse.heavyOps,
    tierMax: MCP_TIER_RPM,
    resolveTier: resolveMcpAbuseTier,
    store: getConfig().cache?.enabled
      ? new CacheRateLimitStore(getCache())
      : undefined,
  });
  app.use("/mcp", guard);
  app.use("/mcp/*", guard);
}

/** Arms the heavy-op x402 seam — only when price+payTo are configured
 *  AND the circle runtime exists. Lazy per-request resolve. */
export function armMcpHeavyGate(
  circleRuntime: CirclePaymentsRuntime | undefined,
): void {
  const mcpAbuse = getConfig().mcpAbuse;
  if (!circleRuntime || !mcpAbuse?.heavyX402Price || !mcpAbuse.heavyX402PayTo) {
    return;
  }
  const gate = circleRuntime.paymentForPrice(mcpAbuse.heavyX402Price, {
    payTo: mcpAbuse.heavyX402PayTo,
    methods: ["POST"],
    description: "MCP heavy-op execution",
    mimeType: "application/json",
    extensions: bazaarExtensionFor("mcp:heavy-op"),
  });
  // PaymentMiddleware allows non-Promise returns — normalize.
  setMcpHeavyGate((c, next) => Promise.resolve(gate(c, next)));
  logger.info("mcp abuse-guard: x402 heavy-op gate armed");
}
