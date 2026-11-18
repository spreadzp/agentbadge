import { Hono } from "hono";

/**
 * SLICE-234-33: well-known probe-variant aliases.
 *
 * Dedicated module so aliases don't grow the already-oversized
 * discovery.ts (token-limit hook). Mounted at "/" like every
 * well-known sub-app — paths are absolute.
 *
 * Existing aliases live elsewhere by history: `/.well-known/x402`
 * and `/.well-known/agent.json` (MANIFEST_REGISTRY redirectTo).
 * New probe variants go HERE.
 */
export const wellKnownAliasRoutes = new Hono();

// x402 bazaar-discovery variant probe → canonical x402.json.
wellKnownAliasRoutes.get("/.well-known/x402-bazaar-discovery.json", (c) =>
  c.redirect("/.well-known/x402.json", 301),
);
