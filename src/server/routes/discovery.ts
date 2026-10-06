/**
 * EPIC-178 (SLICE-178-1): generated discovery routes — /llms.txt,
 * /llms-full.txt (registry-driven; slices add manifests, not routes).
 *
 * Sources are collected lazily on first request (after index.ts wires
 * the app into `setDiscoveryApp`) and cached in memory. DISCOVERY_LIVE=1
 * rebuilds per request for dev. `createDiscoveryRoutes(fn)` injects a
 * custom source collector — used by tests (no app/env required).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
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
export function createDiscoveryRoutes(collect: () => DiscoverySources = defaultCollect): Hono {
  const routes = new Hono();
  let cache: Map<string, GeneratedManifest> | null = null;

  const manifests = () => {
    if (process.env.DISCOVERY_LIVE === "1" || cache === null) {
      cache = generateAll(collect());
    }
    return cache;
  };

  routes.get(
    "/llms.txt",
    describeRoute({
      tags: ["Discovery"],
      summary: "LLM-friendly catalog (llmstxt.org)",
      description:
        "Machine-readable entry point for LLM agents: services, auth, paid endpoints, and links to all discovery surfaces. Generated from live sources — regenerated via `bun run gen:discovery`.",
      responses: {
        200: {
          description: "llms.txt per llmstxt.org convention",
          content: { "text/plain": {} },
        },
      },
    }),
    (c) => {
      const m = manifests().get("/llms.txt")!;
      return c.text(m.body, 200, {
        "Cache-Control": "public, max-age=300",
      });
    },
  );

  routes.get(
    "/llms-full.txt",
    describeRoute({
      tags: ["Discovery"],
      summary: "Full-text LLM context (concatenated site content)",
      description:
        "Full site content as plain text in a single request — services, FAQ, blog, guides. Enables RAG pipelines and embedded agents to ingest all content without browsing.",
      responses: {
        200: {
          description: "Full-text content",
          content: { "text/plain": {} },
        },
      },
    }),
    (c) => {
      const m = manifests().get("/llms-full.txt")!;
      return c.text(m.body, 200, {
        "Cache-Control": "public, max-age=300",
      });
    },
  );

  return routes;
}

/** Default singleton mounted by routes/index.ts. */
export const discoveryManifestRoutes = createDiscoveryRoutes();

export { enumeratePublicRoutes, MANIFEST_REGISTRY };
