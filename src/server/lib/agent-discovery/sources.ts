/**
 * EPIC-178 (SLICE-178-1): Discovery sources — the impure edge of the
 * agent-discovery module. `collectSources()` gathers live inputs once;
 * all builders in this package take `DiscoverySources` and are pure.
 *
 * Sources: getLlmsTxt()/getCatalog() (hedera-core), BLOG_ARTICLES,
 * FAQ entries, DID auth section, BASE_URL, enumerated app routes
 * (Hono app.routes), and optional SKU registry (EPIC-179, absent →
 * Paid Services section degrades).
 */

import type { Hono } from "hono";
import { getCatalog, getLlmsTxt, type TierEntry } from "@agentbadge/hedera-core";
import { BLOG_ARTICLES, type BlogArticle } from "../blog-data";
import { didAuthSectionCompact } from "../did-auth-docs";
import { BASE_URL } from "../page-meta";
import { getFaqEntries, type QaPair } from "../../../views/faq-page";

/** Paid-service SKU — future EPIC-179 catalog entry (soft-dep). */
export interface DiscoverySku {
  /** Immutable `surface:slug` id. */
  id: string;
  name: string;
  endpoint: string;
  priceUsd: string;
  description?: string;
}

export interface DiscoverySources {
  /** Canonical site URL (absolute, no trailing slash). */
  baseUrl: string;
  /** Compact DID auth section (did-auth-docs). */
  authSection: string;
  /** Existing core llms.txt body from @agentbadge/hedera-core. */
  llmsCore: string;
  /** Blog articles (markdown mirrors live at /blog/<slug>.md). */
  articles: BlogArticle[];
  /** FAQ pairs for llms-full.txt. */
  faqEntries: QaPair[];
  /** Catalog tiers (passport pricing). */
  tiers: TierEntry[];
  /**
   * Enumerated public routes as "METHOD /path" strings (from Hono
   * `app.routes`). Sorted/deduped by collectSources. Optional — omit in
   * unit tests or when the app isn't available (script may inject).
   */
  appRoutes: string[];
  /** EPIC-179 SKU registry; empty/absent → Paid Services degrades. */
  skus?: DiscoverySku[];
}

/** Path prefixes that belong in the public agent-facing API surface. */
const PUBLIC_ROUTE_PREFIXES = ["/api/", "/.well-known/"];
/** Paths that are noise for agents (admin, internal, assets). */
const EXCLUDED_PREFIXES = ["/api/admin", "/api/internal"];

/**
 * Extract public route list from a Hono app. Dedupes, filters to
 * agent-relevant paths (/api/*, /.well-known/*), sorts for determinism.
 */
export function enumeratePublicRoutes(app: {
  routes: Array<{ method: string; path: string }>;
}): string[] {
  const seen = new Set<string>();
  for (const r of app.routes) {
    const path = r.path;
    const isPublic = PUBLIC_ROUTE_PREFIXES.some((p) => path.startsWith(p));
    const excluded = EXCLUDED_PREFIXES.some((p) => path.startsWith(p));
    const method = r.method === "ALL" ? "GET" : r.method;
    if (isPublic && !excluded && (method === "GET" || method === "POST")) {
      seen.add(`${method} ${path}`);
    }
  }
  return [...seen].sort();
}

/**
 * Gather live sources. Single place allowed to touch env/modules —
 * builders stay pure. `app` optional: index.ts wires it after mounts;
 * gen-discovery script passes createApp() result.
 */
export function collectSources(app?: Hono): DiscoverySources {
  return {
    baseUrl: BASE_URL,
    authSection: didAuthSectionCompact(),
    llmsCore: getLlmsTxt(),
    articles: BLOG_ARTICLES,
    faqEntries: getFaqEntries(),
    tiers: getCatalog(),
    appRoutes: app ? enumeratePublicRoutes(app) : [],
    skus: [],
  };
}
