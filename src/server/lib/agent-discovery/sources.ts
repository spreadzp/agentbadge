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
import { openApiConfig } from "../../openapi";
import { getNamespace, listTools } from "@agentbadge/mcp";
import { allSkus, defaultSources as catalogSources } from "../service-catalog";
import { didKeyMaterialFromEnv, DID_VM_FRAGMENT } from "./did-key";

/** MCP namespaces exposed on /mcp/<ns> — mirrors routes/well-known/agent-card.ts. */
export const MCP_NAMESPACES = ["passport", "market", "discovery", "audit"] as const;
const MCP_NAMESPACE_DESCRIPTIONS: Record<string, string> = {
  passport: "Agent identity, signing, and escrow tools",
  market: "Marketplace and dataset tools",
  discovery: "Agent directory, guide, A2A messaging, and discovery tools",
  audit: "Audit catalog, compliance checking, and OpenAPI parity tools",
};

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

  // ─── SLICE-178-2: .well-known sources ────────────────────────────

  /** OpenAPI info block (title/version/description) — card metadata. */
  apiInfo?: { title: string; version: string; description: string };
  /** MCP server introspection (namespaces + tool listing). */
  mcpServer?: {
    name: string;
    version: string;
    namespaces: Array<{
      name: string;
      description: string;
      tools: Array<{ name: string; description: string }>;
    }>;
    tools: Array<{ name: string; description: string }>;
  };
  /** Env-dependent values for .well-known manifests. */
  wellKnownEnv?: {
    facilitatorUrl: string;
    hederaNetwork: string;
    passportTokenId?: string;
    directoryTopicId?: string;
    auditTopicId?: string;
    evmChainId: string;
    erc8004: { chainId: number; registry: string; agentId: string };
    /** Multi-chain contract addresses (agent-card x-agentbadge.blockchain). */
    contracts?: {
      trustRegistry: string;
      trustBadge: string;
      agentPassportBase: string;
      taskEscrow: string;
      taskMarketplaceAsc: string;
      taskState: string;
    };
  };
  /** did.json gate — publish DID document only when DID is live (D-178-9). */
  didEnabled?: boolean;
  /**
   * SLICE-178-7: Ed25519 key material for the did:web document
   * (verificationMethod + jwks). Injected by collectSources from
   * DID_SIGNING_KEY; undefined → did.json is gated off (honest absence).
   */
  didKey?: {
    publicJwk: { kty: "OKP"; crv: "Ed25519"; x: string; kid: string };
    /** Verification-method fragment used in the DID document. */
    fragment: string;
  };
  /** Injected clock (security.txt Expires). Defaults to build time. */
  now?: Date;
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
  const didKeyMaterial = didKeyMaterialFromEnv();
  return {
    baseUrl: BASE_URL,
    authSection: didAuthSectionCompact(),
    llmsCore: getLlmsTxt(),
    articles: BLOG_ARTICLES,
    faqEntries: getFaqEntries(),
    tiers: getCatalog(),
    appRoutes: app ? enumeratePublicRoutes(app) : [],
    // SLICE-179-4: llms.txt Paid Services section is generated from the
    // SKU registry — no manual service lists.
    skus: allSkus(catalogSources())
      .filter((s) => s.enabled !== false)
      .map((s) => ({
        id: s.sku_id,
        name: s.name,
        endpoint: s.endpoint.path,
        priceUsd: s.price_usd ?? "dynamic",
        description: s.description,
      })),
    apiInfo: {
      title: openApiConfig.info.title,
      version: openApiConfig.info.version,
      description: openApiConfig.info.description,
    },
    mcpServer: collectMcpServer(),
    wellKnownEnv: collectWellKnownEnv(),
    didEnabled: didKeyMaterial !== null,
    // SLICE-178-7: DID_SIGNING_KEY → public JWK for the did:web document.
    // Garbage/absent key → undefined → did.json gated off (honest absence).
    didKey:
      didKeyMaterial === null
        ? undefined
        : {
          publicJwk: didKeyMaterial.publicJwk,
          fragment: DID_VM_FRAGMENT,
        },
    now: new Date(),
  };
}

/** EIP-8004 registries — canonical IdentityRegistry (mainnets). */
export const ERC8004_REGISTRY_MAINNET = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/** Live env reads for .well-known manifests (impure edge). */
function collectWellKnownEnv(): NonNullable<DiscoverySources["wellKnownEnv"]> {
  return {
    facilitatorUrl:
      process.env.x402_FACILITATOR_URL ??
      process.env.FACILITATOR_URL ??
      "https://facilitator-agentbadge.fly.dev",
    hederaNetwork: process.env.HEDERA_NETWORK ?? "testnet",
    passportTokenId: process.env.PASSPORT_TOKEN_ID,
    directoryTopicId: process.env.DIRECTORY_TOPIC_ID,
    auditTopicId: process.env.AUDIT_TOPIC_ID,
    evmChainId: process.env.ARC_CHAIN_ID ?? "5042",
    erc8004: {
      // EPIC-194-1: dedicated env — ARC_CHAIN_ID means "payments chain"
      // (legitimately testnet in some envs); identity anchors are mainnet.
      chainId: Number(process.env.ERC8004_CHAIN_ID ?? 5042),
      registry: process.env.ERC8004_REGISTRY ?? ERC8004_REGISTRY_MAINNET,
      agentId: process.env.ERC8004_AGENT_ID ?? "0",
    },
    contracts: {
      trustRegistry: process.env.TRUST_REGISTRY_ADDRESS ?? "",
      trustBadge: process.env.TRUST_BADGE_ADDRESS ?? "",
      agentPassportBase: process.env.AGENT_PASSPORT_BASE_ADDRESS ?? "",
      taskEscrow: process.env.TASK_ESCROW_ADDRESS ?? "",
      taskMarketplaceAsc: process.env.TASK_MARKETPLACE_ASC_ADDRESS ?? "",
      taskState: process.env.TASK_STATE_ADDRESS ?? "",
    },
  };
}

/** MCP introspection — namespaces + tool listings from the live registry. */
function collectMcpServer(): DiscoverySources["mcpServer"] {
  try {
    const namespaces = MCP_NAMESPACES.map((nsName) => {
      const ns = getNamespace(nsName);
      return {
        name: nsName,
        description: MCP_NAMESPACE_DESCRIPTIONS[nsName] ?? `${nsName} MCP namespace`,
        tools: (ns ? ns.listTools() : []).map((t) => ({ name: t.name, description: t.description })),
      };
    });
    return {
      name: "agentbadge",
      version: openApiConfig.info.version,
      namespaces,
      tools: listTools().map((t) => ({ name: t.name, description: t.description })),
    };
  } catch {
    return undefined;
  }
}
