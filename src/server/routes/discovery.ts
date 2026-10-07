/**
 * EPIC-178 (SLICE-178-1/178-2): generated discovery routes — every
 * MANIFEST_REGISTRY entry becomes a GET route. Slices add manifests to
 * the registry, never routes here.
 *
 * Sources are collected lazily on first request (after index.ts wires
 * the app into `setDiscoveryApp`) and cached in memory. DISCOVERY_LIVE=1
 * rebuilds per request for dev. `createDiscoveryRoutes(fn)` injects a
 * custom source collector — used by tests (no app/env required).
 *
 * - redirectTo entries → 301 (agent.json → agent-card.json, D-178-4)
 * - enabled() gates → 404 when disabled (did.json, D-178-9)
 * - per-entry contentType + cacheMaxAge
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { srcAttribution } from "../middleware/src-attribution";
import {
  collectSources,
  enumeratePublicRoutes,
  generateAll,
  MANIFEST_REGISTRY,
  type DiscoverySources,
  type GeneratedManifest,
} from "../lib/agent-discovery";
import type { Hono as HonoApp } from "hono";

/** App wired post-mount by index.ts so enumeratePublicRoutes sees everything. */
let discoveryApp: HonoApp | null = null;
export function setDiscoveryApp(app: HonoApp): void {
  discoveryApp = app;
}

function defaultCollect(): DiscoverySources {
  return collectSources(discoveryApp ?? undefined);
}

/**
 * Build a Hono app serving every registered manifest.
 * `collect` defaults to `collectSources(wiredApp)`; lazy + memoized so
 * the route table is fully mounted before enumeration.
 */
export function createDiscoveryRoutes(
  collect: () => DiscoverySources = defaultCollect,
): Hono {
  const routes = new Hono();
  let cache: Map<string, GeneratedManifest> | null = null;

  // SLICE-178-5: ?src=<registry> attribution on every manifest endpoint.
  routes.use(srcAttribution());

  const manifests = () => {
    if (process.env.DISCOVERY_LIVE === "1" || cache === null) {
      cache = generateAll(collect());
    }
    return cache;
  };

  for (const entry of MANIFEST_REGISTRY) {
    routes.get(
      entry.path,
      describeRoute({
        tags: ["Discovery"],
        summary: entry.summary ?? `Generated manifest ${entry.path}`,
        hide: false,
        responses: {
          200: {
            description: entry.summary ?? entry.path,
            content: { [entry.contentType]: {} },
          },
        },
      }),
      (c) => {
        const m = manifests().get(entry.path);
        if (!m) return c.notFound();
        if (m.redirectTo) return c.redirect(m.redirectTo, 301);
        return new Response(m.body, {
          status: 200,
          headers: {
            "Content-Type": m.contentType,
            "Cache-Control": `public, max-age=${m.cacheMaxAge}`,
          },
        });
      },
    );
  }

  return routes;
}

/** Default singleton mounted by routes/index.ts. */
export const discoveryManifestRoutes = createDiscoveryRoutes();

export { enumeratePublicRoutes, MANIFEST_REGISTRY };
