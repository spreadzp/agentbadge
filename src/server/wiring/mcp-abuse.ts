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
import {
  DEFAULT_HEAVY_OPS,
  mcpAbuseGuard,
  setMcpHeavyGate,
} from "../middleware/mcp-abuse-guard";
import { AGENT_INTERACTION_TOOLS } from "../lib/agent-interaction/registry";
import { didAuthEnrich } from "../middleware/did-enrich";
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
 *  The guard is idempotent per request, so the double-mount is cheap.
 *  EPIC-259 (SLICE-259-4): optional DID-signature enrichment mounts
 *  FIRST on the same paths — verified callers get verifiedDid for
 *  subject-level auth inside tools (e.g. upgrade_tier) and for the
 *  guard's resolveMcpAbuseTier. ONE mount for /mcp + /mcp/* — namespace
 *  sub-apps rely on it (per-route mounts would double-consume the
 *  single-use nonce). Anonymous callers pass through untouched. */
export function wireMcpAbuseGuard(app: Hono): void {
  app.use("/mcp", didAuthEnrich());
  app.use("/mcp/*", didAuthEnrich());
  const mcpAbuse = getConfig().mcpAbuse;
  if (!mcpAbuse) return;
  // Arc-audit M8 (233-10): the heavy set is DERIVED — a hand-mirrored
  // copy (or an env override) that forgets an agentbadge_* heavy tool
  // silently un-meters it. Union the registry's rateClass=heavy names
  // into whatever list is configured.
  const registryHeavy = AGENT_INTERACTION_TOOLS.filter(
    (t) => t.rateClass === "heavy",
  ).map((t) => t.name);
  const guard = mcpAbuseGuard({
    anonMax: mcpAbuse.anonRpm,
    keyedMax: mcpAbuse.keyedRpm,
    heavyMax: mcpAbuse.heavyRpm,
    heavyOps: [
      ...(mcpAbuse.heavyOps ?? DEFAULT_HEAVY_OPS),
      ...registryHeavy,
    ],
    tierMax: MCP_TIER_RPM,
    resolveTier: resolveMcpAbuseTier,
    store: getConfig().cache?.enabled
      ? new CacheRateLimitStore(getCache())
      : undefined,
  });
  // IMPORTANT: pass the SAME instance to both mounts — the per-request
  // dedup key compares the instance's flag value; two mcpAbuseGuard()
  // calls here would double-count every request (arc-audit N-4).
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
