import type { AgentReadinessRule } from "./rule.schema";

// ─── Rule bundles — sellable marketplace scan packs (EPIC-133) ───
// Registry-driven design: RULE_BUNDLES is the single source of truth.
// Adding a bundle = one registry entry — endpoint, pricing, listing,
// and CLI all derive from it (D3). Every rule maps to exactly one
// bundle: ruleOverrides first, then category lookup (D1).

/** Marketplace bundle slug — doubles as listing id (D2). */
export type BundleId =
  | "discovery-crawling"
  | "page-meta-seo"
  | "skills-agent-ux"
  | "content-negotiation"
  | "openapi-docs"
  | "mcp-webmcp"
  | "payments-x402"
  | "auth-identity"
  | "semantic-policy"
  | "live-verification";

/** Fetcher-cost class driving the price table (D4). */
export type CostClass = "light" | "medium" | "heavy";

/** All 10 bundle ids in registry order. */
export const BUNDLE_IDS: readonly BundleId[] = [
  "discovery-crawling",
  "page-meta-seo",
  "skills-agent-ux",
  "content-negotiation",
  "openapi-docs",
  "mcp-webmcp",
  "payments-x402",
  "auth-identity",
  "semantic-policy",
  "live-verification",
] as const;

export interface BundleDef {
  /** Marketplace slug — human-meaningful, used in API + CLI (D2). */
  id: BundleId;
  /** Display name for listings and reports. */
  name: string;
  /** Short description of the bundle's scope. */
  description: string;
  /**
   * Agent-facing Q&A (D2): what the pack checks and what the buyer
   * gets — e.g. "Checks x402/L402/pricing endpoints. You get:
   * payments sub-score + gap list."
   */
  helpText: string;
  /** Fetcher-cost class → price lookup (D4). */
  costClass: CostClass;
  /** Rule categories mapped to this bundle. */
  categories: string[];
  /** Explicit rule IDs overriding the category mapping (D1). */
  ruleOverrides: string[];
  /**
   * Extra fetcher sources beyond the bundle's own rules'
   * `check.sources` — makes the bundle self-sufficient (D5).
   * E.g. semantic-policy needs guide/openapi/llms evidence without
   * owning those rules.
   */
  evidenceSources: string[];
  /** true = bundle runs without active probing (fast profile). */
  fast: boolean;
  /** Optional per-bundle price override (USDC string) — wins over costClass lookup. */
  priceOverride?: string;
}

/**
 * The 10 marketplace bundles — single source of truth (D3).
 * Rule→bundle map per docs/BUSINESS/1809-rule-bundles.md §"Полная карта".
 *
 * `categories` lists a category ONLY when every rule of that category
 * belongs to this bundle; all other members come via `ruleOverrides`
 * (override wins over category — D1). Categories left unclaimed by any
 * bundle (`documentation`, `actionability`, `machine_readable`) force
 * explicit override assignment for new rules — the coverage test fails
 * on unmapped rules by design.
 */
export const RULE_BUNDLES: readonly BundleDef[] = [
  {
    id: "discovery-crawling",
    name: "Discovery & Crawling",
    description: "Can agents find your site? robots.txt, sitemaps, machine-readable entry points.",
    helpText:
      "Checks robots.txt, sitemap, llms.txt/llms-full, ai.txt, agents.txt, AI sitemap, DNS-AID, Link headers (RFC 8288), API Catalog (RFC 9727), RSS/feeds, favicon, crawl-delay, Google-Extended, LLM policy. You get: discovery sub-score + gap list for crawlability.",
    costClass: "light",
    categories: ["discovery", "agents_txt"],
    ruleOverrides: ["AB-024", "AB-025", "AB-049", "AB-053", "AB-055"],
    evidenceSources: [],
    fast: true,
  },
  {
    id: "page-meta-seo",
    name: "Page Meta & SEO/AEO",
    description: "Search and generative-engine optimization: meta, JSON-LD, OpenGraph, content signals.",
    helpText:
      "Checks JSON-LD, OpenGraph, twitter:card, schema.org, BlogPosting/Service/BreadcrumbList JSON-LD, LocalBusiness + hours + region, GA4/Plausible/Search Console, title quality, AI-Agent Discovery meta, llms links in HTML. You get: SEO/AEO sub-score + meta gap list.",
    costClass: "light",
    categories: ["seo_aeo"],
    ruleOverrides: ["AB-015", "AB-016", "AB-052", "AB-081", "AB-082", "AB-083", "AB-084", "AB-089", "AB-090", "AB-092", "AB-177"],
    evidenceSources: [],
    fast: true,
  },
  {
    id: "skills-agent-ux",
    name: "Skills & Agent UX",
    description: "Agent-facing skill surface: skill files, A2A agent card, heartbeat, error catalog.",
    helpText:
      "Checks skill file + frontmatter, skills index, A2A Agent Card (published/verified/v1.0+), heartbeat.md, skill.json, error catalog. You get: agent-UX sub-score + skills gap list.",
    costClass: "light",
    categories: ["skills"],
    ruleOverrides: ["AB-074", "AB-075", "AB-109", "AB-178", "AB-179", "AB-180"],
    evidenceSources: [],
    fast: true,
  },
  {
    id: "content-negotiation",
    name: "Content & Negotiation",
    description: "Machine-readable content delivery: Accept negotiation, markdown mirrors, semantic HTML.",
    helpText:
      "Checks Accept: markdown/JSON/text, q-values, Vary, inline negotiation, agent UA, cache headers, JSON 404, canonical, markdown mirror, content depth, breadcrumbs, AEO summary, alt texts, lazy loading. You get: content sub-score + negotiation gap list.",
    costClass: "medium",
    categories: ["content_negotiation", "accessibility"],
    ruleOverrides: ["AB-045", "AB-046", "AB-054", "AB-100", "AB-101", "AB-106", "AB-107", "AB-173"],
    evidenceSources: [],
    fast: true,
  },
  {
    id: "openapi-docs",
    name: "OpenAPI & Docs",
    description: "API contracts and agent guides: OpenAPI validity, agent-guide, error semantics.",
    helpText:
      "Checks agent-guide discoverable + schema-valid, OpenAPI present/valid/reachable/response-match, x-payment-info, guide↔spec consistency, capability coverage, descriptions/parameters/examples/error semantics, next_call. You get: API-docs sub-score + contract gap list.",
    costClass: "medium",
    categories: ["openapi", "error_semantics"],
    ruleOverrides: ["AB-003", "AB-004", "AB-005", "AB-007", "AB-009", "AB-146", "AB-147", "AB-148", "AB-182"],
    evidenceSources: [],
    fast: true,
  },
  {
    id: "mcp-webmcp",
    name: "MCP & WebMCP",
    description: "MCP server surface: descriptors, tools list/call, streaming, auth, WebMCP.",
    helpText:
      "Checks MCP descriptor, tools/list + tools/call, SSE transport, auth discovery, server name, REST parity, check_compliance, namespace isolation, well-known, tool-description quality, WebMCP manifest/forms/browser tools, actionability surface. You get: MCP sub-score + surface gap list.",
    costClass: "medium",
    categories: ["webmcp"],
    ruleOverrides: ["AB-006", "AB-020", "AB-021", "AB-022", "AB-023", "AB-047", "AB-085", "AB-086", "AB-170", "AB-171"],
    evidenceSources: [],
    fast: false,
  },
  {
    id: "payments-x402",
    name: "Payments & x402",
    description: "Agent payment rails: x402, L402, bazaar discovery, pricing endpoints.",
    helpText:
      "Checks live 402, x402 challenge decodable, Payment-Required header, payTo, amount, x402.json, Bazaar, facilitator, L402 macaroon/invoice, MPP, SPT, pricing + rate limits machine-readable. You get: payments sub-score + rails gap list.",
    costClass: "medium",
    categories: ["payments", "bazaar"],
    ruleOverrides: ["AB-010", "AB-011"],
    evidenceSources: [],
    fast: false,
  },
  {
    id: "auth-identity",
    name: "Auth & Identity",
    description: "Agent authentication and identity: OAuth, bot auth, DID, owner verification.",
    helpText:
      "Checks owner verification (DNS/meta), WebFinger, DID, bot auth directory/members/keys, OAuth Protected Resource + Auth Server metadata (RFC 9728), Web Bot Auth, AAuth, short-lived tokens, OAuth2 vs static keys, Nostr/AT Protocol/app links, auth clarity. You get: auth sub-score + identity gap list.",
    costClass: "medium",
    categories: ["identity", "bot_auth"],
    ruleOverrides: ["AB-013", "AB-140", "AB-144"],
    evidenceSources: [],
    fast: true,
  },
  {
    id: "semantic-policy",
    name: "Semantic & Policy Audit",
    description: "LLM-evaluated semantics: pricing consistency, agent policy, injection hygiene.",
    helpText:
      "LLM-evaluates pricing discoverability/consistency, rate limits, retry semantics, versioning, sandbox, agent policy machine-readable, capability list, business constraints, support path, prompt-injection hygiene, agent access policy, error schema, auth.md. You get: policy sub-score + semantic gap list.",
    costClass: "heavy",
    categories: ["pricing", "rate_limits", "retry_semantics", "versioning", "sandbox", "agent_policy"],
    ruleOverrides: ["AB-012", "AB-064", "AB-152", "AB-158", "AB-159", "AB-160"],
    evidenceSources: ["guide", "openapi", "llms"],
    fast: false,
  },
  {
    id: "live-verification",
    name: "Live Verification & Security",
    description: "Real API calls: OAuth token endpoint, authenticated calls, security headers.",
    helpText:
      "Runs real calls — OAuth token endpoint, authenticated call, token format, endpoint callable, response matches schema, content-type + HTTPS redirect, CSP, Referrer-Policy, CSP↔analytics consistency. Most expensive bundle — active requests against the target API. You get: verification sub-score + security gap list.",
    costClass: "heavy",
    categories: ["verification", "infrastructure"],
    ruleOverrides: ["AB-008"],
    evidenceSources: ["infrastructure"],
    fast: false,
  },
] as const;

// ─── Resolvers (SLICE-133-3) ───

const CATEGORY_TO_BUNDLE = new Map<string, BundleId>(
  RULE_BUNDLES.flatMap((b) => b.categories.map((c) => [c, b.id] as const)),
);

const RULE_OVERRIDE_TO_BUNDLE = new Map<string, BundleId>(
  RULE_BUNDLES.flatMap((b) => b.ruleOverrides.map((r) => [r, b.id] as const)),
);

const BUNDLE_BY_ID = new Map<BundleId, BundleDef>(RULE_BUNDLES.map((b) => [b.id, b]));

/** Resolve the bundle for a rule: explicit override wins, then category (D1). */
export function bundleForRule(rule: AgentReadinessRule): BundleId | null {
  const override = RULE_OVERRIDE_TO_BUNDLE.get(rule.rule_id);
  if (override) return override;
  return CATEGORY_TO_BUNDLE.get(rule.category) ?? null;
}

/** All rules belonging to the given bundles (canonical or legacy ids). */
export function rulesForBundles(
  bundleIds: readonly string[],
  rules: readonly AgentReadinessRule[],
): AgentReadinessRule[] {
  const wanted = new Set(resolveBundleIds(bundleIds).ok);
  return rules.filter((r) => {
    const bundle = bundleForRule(r);
    return bundle !== null && wanted.has(bundle);
  });
}

/**
 * Union of fetcher sources needed by the given bundles: each bundle's
 * rules' `check.sources` plus the bundle's own `evidenceSources` (D5).
 * Dotted sources (e.g. "a.b") are kept as-is — the orchestrator
 * resolves them against the snapshot tree.
 */
export function sourcesForBundles(
  bundleIds: readonly string[],
  rules: readonly AgentReadinessRule[],
): string[] {
  const resolved = resolveBundleIds(bundleIds).ok;
  const sources = new Set<string>();
  for (const id of resolved) {
    const def = BUNDLE_BY_ID.get(id);
    for (const s of def?.evidenceSources ?? []) sources.add(s);
  }
  for (const rule of rulesForBundles(resolved, rules)) {
    const check = rule.check as { sources?: string[] };
    for (const s of check.sources ?? []) sources.add(s);
  }
  return [...sources];
}

// ─── Legacy pack aliases (SLICE-133-4, D8) ───
// Old PackId → BundleId. Keeps existing CLI `--packs` invocations and
// stored references working after the rename.

export const LEGACY_PACK_ALIASES: Readonly<Record<string, BundleId>> = {
  discovery: "discovery-crawling",
  documentation: "openapi-docs",
  actionability: "skills-agent-ux",
  safety: "auth-identity",
  mcp: "mcp-webmcp",
  "seo-geo": "page-meta-seo",
  payments: "payments-x402",
  infrastructure: "live-verification",
} as const;

const CANONICAL_IDS = new Set<string>(BUNDLE_IDS);

/**
 * Resolve a user-supplied id to a canonical BundleId: canonical id →
 * itself; legacy PackId → mapped bundle; unknown → null.
 */
export function resolveBundleId(input: string): BundleId | null {
  if (CANONICAL_IDS.has(input)) return input as BundleId;
  return LEGACY_PACK_ALIASES[input] ?? null;
}

/** Batch resolution for API/CLI validation — splits known from unknown. */
export function resolveBundleIds(inputs: readonly string[]): {
  ok: BundleId[];
  unknown: string[];
} {
  const ok: BundleId[] = [];
  const seen = new Set<BundleId>();
  const unknown: string[] = [];
  for (const raw of inputs) {
    const id = resolveBundleId(raw);
    if (id === null) {
      unknown.push(raw);
    } else if (!seen.has(id)) {
      seen.add(id);
      ok.push(id);
    }
  }
  return { ok, unknown };
}

// ─── Source → fetcher resource normalization (SLICE-133-8) ───
// `check.sources` mixes fetcher resource names with evidence paths
// resolved inside snapshots (e.g. "agent_guide.capabilities" reads the
// `guide` snapshot; "bot-auth" is the `bot_auth` fetcher). Map them to
// the resource that produces the evidence.

const SOURCE_TO_RESOURCE: Readonly<Record<string, string>> = {
  "bot-auth": "bot_auth",
  dns_txt_record: "guide",
  meta_tag_challenge: "guide",
  security_txt: "guide",
} as const;

function sourceToResource(source: string): string {
  if (source.startsWith("agent_guide.")) return "guide";
  if (source.startsWith("openapi.")) return "openapi";
  return SOURCE_TO_RESOURCE[source] ?? source;
}

/**
 * Fetcher resources needed by the given bundles: `sourcesForBundles`
 * normalized to resource names. May still contain non-resource names
 * (probe ids, unknown evidence paths) — callers should intersect with
 * the orchestrator's known resource list as the final guard.
 */
export function resourcesForBundles(
  bundleIds: readonly string[],
  rules: readonly AgentReadinessRule[],
): string[] {
  const seen = new Set<string>();
  for (const s of sourcesForBundles(bundleIds, rules)) {
    seen.add(sourceToResource(s));
  }
  return [...seen];
}

// ─── Pricing (SLICE-133-5, D4) ───
// Config-driven: costClass → default price; per-bundle priceOverride
// wins; SCAN_PRICE_{LIGHT,MEDIUM,HEAVY} env vars override at call time
// (read per call — test-friendly, no module-load caching).

export const USDC = "USDC" as const;

export const DEFAULT_COST_CLASS_PRICES: Readonly<Record<CostClass, string>> = {
  light: "0.30",
  medium: "0.50",
  heavy: "0.90",
} as const;

/** All 10 bundles = $5.10 summed → $4.50 full-scan (~12% discount). */
export const FULL_SCAN_PRICE = "4.50" as const;

const ENV_PRICE_KEYS: Record<CostClass, string> = {
  light: "SCAN_PRICE_LIGHT",
  medium: "SCAN_PRICE_MEDIUM",
  heavy: "SCAN_PRICE_HEAVY",
};

export interface BundlePrice {
  amount: string;
  currency: string;
}

/**
 * Price for one bundle: `priceOverride` field wins, then env var
 * `SCAN_PRICE_<CLASS>`, then `DEFAULT_COST_CLASS_PRICES[costClass]`.
 */
export function bundlePrice(bundle: BundleDef): BundlePrice {
  const amount =
    bundle.priceOverride ??
    process.env[ENV_PRICE_KEYS[bundle.costClass]] ??
    DEFAULT_COST_CLASS_PRICES[bundle.costClass];
  return { amount, currency: USDC };
}

/**
 * Total price for a set of bundles (canonical ids). All 10 bundles →
 * FULL_SCAN_PRICE discount. Unknown ids are ignored (resolve first via
 * resolveBundleIds at the API layer).
 */
export function totalPrice(bundleIds: readonly string[]): BundlePrice {
  const unique = new Set(bundleIds);
  if (unique.size === RULE_BUNDLES.length) {
    return { amount: FULL_SCAN_PRICE, currency: USDC };
  }
  let cents = 0;
  for (const id of unique) {
    const def = BUNDLE_BY_ID.get(id as BundleId);
    if (!def) continue;
    cents += Math.round(Number(bundlePrice(def).amount) * 100);
  }
  return { amount: (cents / 100).toFixed(2), currency: USDC };
}

// ─── Listing metadata (SLICE-133-6) ───

export interface BundleListing {
  id: BundleId;
  name: string;
  description: string;
  helpText: string;
  costClass: CostClass;
  price: BundlePrice;
  ruleCount: number;
  fast: boolean;
}

export interface BundleCatalog {
  /** Output shape version — bump on breaking changes (D3). */
  v: 1;
  bundles: BundleListing[];
  /** Upsell comparison: full scan price + total rule count. */
  fullScan: { price: BundlePrice; ruleCount: number };
}

/**
 * Marketplace/agent-facing listing for all bundles (or a subset).
 * `bundleIds` accepts canonical and legacy ids (resolved via
 * `resolveBundleId`); unknown ids are ignored.
 */
export function bundleMetadata(
  rules: readonly AgentReadinessRule[],
  bundleIds?: readonly string[],
): BundleCatalog {
  const wanted = bundleIds ? new Set(resolveBundleIds(bundleIds).ok) : null;
  const bundles = RULE_BUNDLES.filter((b) => !wanted || wanted.has(b.id)).map(
    (b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      helpText: b.helpText,
      costClass: b.costClass,
      price: bundlePrice(b),
      ruleCount: rulesForBundles([b.id], rules).length,
      fast: b.fast,
    }),
  );
  return {
    v: 1,
    bundles,
    fullScan: {
      price: { amount: FULL_SCAN_PRICE, currency: USDC },
      ruleCount: rules.length,
    },
  };
}
