import type { AgentReadinessRule } from "./rule.schema";

// ─── Rule packs — sellable category groupings (SLICE-132-8) ───
// Every rule maps to exactly one pack: ruleOverrides first, then category lookup.

export type PackId =
  | "discovery"
  | "documentation"
  | "actionability"
  | "safety"
  | "mcp"
  | "seo-geo"
  | "payments"
  | "infrastructure";

export interface RulePack {
  id: PackId;
  name: string;
  description: string;
  /** Rule categories mapped to this pack */
  categories: string[];
  /** Explicit rule IDs overriding the category mapping */
  ruleOverrides: string[];
  /** Marketplace price; null = free pack */
  price: { amount: string; currency: string } | null;
  /** true = pack runs without active probing (fast profile eligible) */
  fast: boolean;
}

export const RULE_PACKS: readonly RulePack[] = [
  {
    id: "discovery",
    name: "Discovery Pack",
    description: "Can agents find your site? robots.txt, sitemaps, machine-readable entry points.",
    categories: ["discovery", "machine_readable", "agents_txt"],
    ruleOverrides: [],
    price: null,
    fast: true,
  },
  {
    id: "documentation",
    name: "Documentation Pack",
    description: "Docs, formats, and API contracts: llms.txt, OpenAPI, markdown mirrors, error semantics.",
    categories: ["documentation", "content_negotiation", "openapi", "error_semantics", "retry_semantics", "rate_limits", "pricing", "versioning"],
    ruleOverrides: [],
    price: null,
    fast: true,
  },
  {
    id: "actionability",
    name: "Actionability Pack",
    description: "Can agents act on your pages? Forms, ARIA landmarks, named controls, skills.",
    categories: ["actionability", "accessibility", "skills", "sandbox"],
    ruleOverrides: [],
    price: null,
    fast: true,
  },
  {
    id: "safety",
    name: "Safety Pack",
    description: "Trust and security for agent traffic: injection hygiene, MCP tool poisoning, agent access policy, verification, identity.",
    categories: ["agent_policy", "verification", "identity", "bot_auth"],
    ruleOverrides: ["AB-171"], // MCP tool-description poisoning — documentation category, safety pack
    price: { amount: "0.01", currency: "USDC" },
    fast: false,
  },
  {
    id: "mcp",
    name: "MCP Pack",
    description: "MCP server surface: descriptors, tools list/call, streaming, auth.",
    categories: ["webmcp"],
    ruleOverrides: [],
    price: null,
    fast: false,
  },
  {
    id: "seo-geo",
    name: "SEO/GEO Pack",
    description: "Search and generative-engine optimization: meta, JSON-LD, OpenGraph, content signals.",
    categories: ["seo_aeo"],
    ruleOverrides: [],
    price: null,
    fast: true,
  },
  {
    id: "payments",
    name: "Payments Pack",
    description: "Agent payment rails: x402, L402, bazaar discovery, pricing endpoints.",
    categories: ["payments", "bazaar"],
    ruleOverrides: [],
    price: null,
    fast: false,
  },
  {
    id: "infrastructure",
    name: "Infrastructure Pack",
    description: "Hosting and protocol readiness: HTTPS, caching, rate-limit headers, CSP.",
    categories: ["infrastructure"],
    ruleOverrides: [],
    price: null,
    fast: true,
  },
] as const;

const CATEGORY_TO_PACK = new Map<string, PackId>(
  RULE_PACKS.flatMap((p) => p.categories.map((c) => [c, p.id] as const)),
);

const RULE_OVERRIDE_TO_PACK = new Map<string, PackId>(
  RULE_PACKS.flatMap((p) => p.ruleOverrides.map((r) => [r, p.id] as const)),
);

/** Resolve the pack for a rule: explicit override wins, then category. */
export function packForRule(rule: AgentReadinessRule): PackId | null {
  const override = RULE_OVERRIDE_TO_PACK.get(rule.rule_id);
  if (override) return override;
  return CATEGORY_TO_PACK.get(rule.category) ?? null;
}

/** All rules belonging to the given packs. */
export function rulesForPacks(
  packIds: readonly string[],
  rules: readonly AgentReadinessRule[],
): AgentReadinessRule[] {
  const wanted = new Set(packIds);
  return rules.filter((r) => {
    const pack = packForRule(r);
    return pack !== null && wanted.has(pack);
  });
}

/** Union of snapshot sources needed by the given packs' rules (for scoped fetches). */
export function sourcesForPacks(
  packIds: readonly string[],
  rules: readonly AgentReadinessRule[],
): string[] {
  const sources = new Set<string>();
  for (const rule of rulesForPacks(packIds, rules)) {
    const check = rule.check as { sources?: string[] };
    for (const s of check.sources ?? []) sources.add(s);
  }
  return Array.from(sources);
}

/** Marketplace listing metadata for all packs (or a subset). */
export function packMetadata(packIds?: readonly string[]): object[] {
  const wanted = packIds ? new Set(packIds) : null;
  return RULE_PACKS.filter((p) => !wanted || wanted.has(p.id)).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    fast: p.fast,
  }));
}
