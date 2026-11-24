/**
 * EPIC-259 (SLICE-259-3): transport-independent MCP tool authorization.
 *
 * One policy for every entry point (JSON-RPC /mcp, namespace routes,
 * REST /mcp/tools/:name, batch arrays): a tool's `exposure` tier on its
 * registry entry vs the caller's resolved tier. Exposure lives on the
 * tool registration (@agentbadge/mcp ToolEntry.exposure) — deny-by-
 * default is `admin` for unclassified tools.
 *
 * Callers:
 *   - "admin"         — break-glass shared key under
 *                       ADMIN_BREAK_GLASS_ENABLED only (264-9: routed
 *                       through tryBreakGlassKey — every use marks +
 *                       alerts; opk_ creds use /mcp/ops)
 *   - "authenticated" — verified agent identity: agentKeyAuth (agb_)
 *                       or did-auth signature (verifiedDid)
 *   - "anonymous"     — everyone else
 *
 * This is a transport gate: handler-level authorization (ownership,
 * subject binding) still applies inside tools (D-259-Q2).
 */
import type { Context } from "hono";
import { tryBreakGlassKey } from "../middleware/operator-breakglass";
import {
  listTools,
  type ToolExposure,
  type ToolListing,
  type NamespaceRegistry,
} from "@agentbadge/mcp";

export type CallerTier = "anonymous" | "authenticated" | "admin";

const TIER_LEVEL: Record<CallerTier, number> = {
  anonymous: 0,
  authenticated: 1,
  admin: 2,
};

const EXPOSURE_REQUIRED: Record<ToolExposure, CallerTier> = {
  public: "anonymous",
  authenticated: "authenticated",
  admin: "admin",
};

export function resolveCallerTier(c: Context): CallerTier {
  const xAdminKey = c.req.header("X-Admin-Key");
  const authHeader = c.req.header("Authorization");
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (tryBreakGlassKey(xAdminKey || bearerKey || "", c.req.path).accepted) {
    return "admin";
  }

  if (c.get("verifiedDid") || c.get("agentId")) return "authenticated";
  return "anonymous";
}

export function tierAllows(tier: CallerTier, exposure: ToolExposure): boolean {
  return TIER_LEVEL[tier] >= TIER_LEVEL[EXPOSURE_REQUIRED[exposure]];
}

/** Look up a tool's exposure on a registry. Missing tool → undefined
 *  (treat as deny — unknown names must not reach a handler). */
export function toolExposure(
  name: string,
  ns?: NamespaceRegistry,
): ToolExposure | undefined {
  const list = ns ? ns.listTools() : listTools();
  return list.find((t) => t.name === name)?.exposure;
}

export function filterToolsByTier(
  tools: ToolListing[],
  tier: CallerTier,
): ToolListing[] {
  return tools.filter((t) => {
    if (!tierAllows(tier, t.exposure)) return false;
    // SLICE-259-7: anonymous sees the curated discovery subset only —
    // capability-first onboarding (≤20) instead of the full public
    // registry. Extended-public tools stay *callable* anonymously —
    // curation is a listing projection, exposure still gates execution.
    if (tier === "anonymous" && t.publicTier !== "curated") return false;
    return true;
  });
}

/** Agent-readable denial — tells the caller which tier is required and
 *  where to get it (D-259-Q10: denied responses carry the access path). */
export function deniedMessage(name: string, exposure: ToolExposure): string {
  const hint =
    exposure === "authenticated"
      ? "Authenticate with an agb_ API key (register via register_agent) or a DID signature — see /agent-guide."
      : "This tool is restricted to the operator surface.";
  return `Tool '${name}' requires ${EXPOSURE_REQUIRED[exposure]} access. ${hint}`;
}
