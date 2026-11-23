/**
 * Route enumeration for agent-facing catalogs (llms.txt Public API
 * section). Extracted from sources.ts (ESLint max-lines) —
 * SLICE-259-34.
 */

/** Path prefixes that belong in the public agent-facing API surface. */
const PUBLIC_ROUTE_PREFIXES = ["/api/", "/.well-known/"];
/** Paths that are noise for agents (admin, internal, ops, webhooks). */
const EXCLUDED_PREFIXES = [
  "/api/admin",
  "/api/internal",
  // SLICE-217-14: operational surface must not leak into public catalogs —
  // indexer runner is an ops trigger, webhook endpoints are inbound-only.
  "/api/indexer",
  "/api/stripe/webhook",
  "/audit/webhook",
  // SLICE-259-34 (G1): operator/scoped surfaces advertised by raw route
  // dumps — ops inbox, econ ledger, wallet management, keyed intel API,
  // venue instance admin + indexer health, payments ops, inbound
  // webhooks/callbacks and entitlement admin. The OpenAPI spec remains
  // the complete surface; llms.txt lists the agent-facing catalog.
  "/api/ops",
  "/api/ledger",
  "/api/gec",
  "/api/indexnow",
  "/api/intel",
  "/api/payments",
  "/api/wallets",
  "/api/venue/indexer",
  "/api/venue/instances",
  "/api/keeperhub/audit/webhook",
  "/api/v1/entitlements",
  "/api/v1/payments",
];

/**
 * Extract public route list from a Hono app. Dedupes, filters to
 * agent-relevant paths (/api/*, /.well-known/*), sorts for determinism.
 *
 * SLICE-259-34: two-pass — real GET/POST entries first; `ALL` entries
 * (x402-paywall / deprecation middleware registered via use/all on a
 * route path) become `GET` only when no real method exists at the path
 * (drop the middleware shadow → no phantom "GET /api/total-scan").
 * Wildcard `*` and `:param` template paths are not fetchable URLs and
 * are omitted — OpenAPI owns the parameterized surface.
 */
export function enumeratePublicRoutes(app: {
  routes: Array<{ method: string; path: string }>;
}): string[] {
  const isListed = (path: string) =>
    PUBLIC_ROUTE_PREFIXES.some((p) => path.startsWith(p)) &&
    !EXCLUDED_PREFIXES.some((p) => path.startsWith(p)) &&
    !path.includes("*") &&
    !path.includes(":");
  const real = new Set<string>();
  const realAtPath = new Set<string>();
  const allPaths = new Set<string>();
  for (const r of app.routes) {
    if (!isListed(r.path)) continue;
    if (r.method === "GET" || r.method === "POST") {
      real.add(`${r.method} ${r.path}`);
      realAtPath.add(r.path);
    } else if (r.method === "ALL") {
      allPaths.add(r.path);
    }
  }
  for (const path of allPaths) {
    if (!realAtPath.has(path)) real.add(`GET ${path}`);
  }
  return [...real].sort();
}
