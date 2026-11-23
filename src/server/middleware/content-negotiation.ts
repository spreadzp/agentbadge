/**
 * Content negotiation middleware — SLICE-47-4
 *
 * Inspects Accept header and returns appropriate Content-Type
 * for GET requests to HTML pages. Supports text/markdown, application/json,
 * text/plain, and text/html per RFC 9110 §12.5.1.
 */
import type { Context, Next } from "hono";
import { PUBLIC_STATS } from "../lib/public-stats";
import { BRAND_DISAMBIGUATION } from "../lib/brand";

interface AcceptEntry {
  type: string;
  q: number;
}

function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(",")
    .map((part) => {
      const [mediaType, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1;
      return { type: mediaType.trim(), q: isNaN(q) ? 1 : q };
    })
    .filter((e) => e.type.length > 0)
    .sort((a, b) => b.q - a.q);
}

function pickMediaType(accept: string, supported: string[]): string | null {
  const entries = parseAccept(accept);
  for (const entry of entries) {
    if (entry.q === 0) continue;
    for (const sup of supported) {
      if (entry.type === "*/*" || entry.type === sup) return sup;
      // Wildcard subtype: text/*
      if (entry.type.endsWith("/*")) {
        const prefix = entry.type.slice(0, -2);
        if (sup.startsWith(prefix + "/")) return sup;
      }
    }
  }
  return null;
}

// SLICE-259-13: one facts model → md/json/text renders. Every number
// comes from PUBLIC_STATS (live registries), positioning matches
// llms.txt — Arc/ERC-8004 identity, USDC escrow, x402 (Hedera is
// legacy). Guarded by tests/pages/index-md-freshness-259.test.ts.
const HOMEPAGE_FACTS = {
  name: "AgentBadge",
  tagline: "Agent Readiness Platform",
  description:
    "AgentBadge is an agency for the agentic web: a deterministic agent-readiness scanner with evidence, a knowledge layer served three ways (HTML, markdown, Knowledge Object JSON), and a peer-to-peer agent marketplace with USDC escrow on Arc (ERC-8183).",
  get features(): string[] {
    return [
      "Agent Readiness Scanner — deterministic checks with evidence",
      `MCP Server with ${PUBLIC_STATS.mcpTools} tools (curated anonymous set; agb_ key unlocks the full surface)`,
      "Agent Passports — NFT identity; self-serve ERC-8004 registration on Arc (eip155:5042)",
      "Agent Marketplace — paid tasks with USDC escrow on Arc (ERC-8183)",
      "A2A messaging and audit trail",
    ];
  },
  endpoints: {
    MCP: "/mcp",
    "llms.txt": "/llms.txt",
    "Agent Card": "/.well-known/agent-card.json",
    OpenAPI: "/api/specs",
    "AI Sitemap": "/ai-sitemap.xml",
  } as const,
  quickStart: `# Scan any URL for agent readiness (free, JSON report)
curl "https://agentbadge.xyz/scan?url=https://example.com"

# Connect via MCP — anonymous callers get a curated tool set;
# register free for an agb_ key to unlock the full surface
# Endpoint: https://agentbadge.xyz/mcp`,
  docsUrl: "https://agentbadge.xyz",
  // SLICE-259-25: brand disambiguation — same sentence as
  // llms.txt/skill.md/agent-card (lib/brand.ts).
  disambiguation: BRAND_DISAMBIGUATION,
};

function getHomepageMarkdown(): string {
  const features = HOMEPAGE_FACTS.features
    .map((f) => `- ${f}`)
    .join("\n");
  const endpoints = Object.entries(HOMEPAGE_FACTS.endpoints)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `# ${HOMEPAGE_FACTS.name} — ${HOMEPAGE_FACTS.tagline}

${HOMEPAGE_FACTS.description}

## Key Features

${features}

## Endpoints

${endpoints}

## Quick Start

\`\`\`bash
${HOMEPAGE_FACTS.quickStart}
\`\`\`

Visit ${HOMEPAGE_FACTS.docsUrl} for full documentation.

Note: ${HOMEPAGE_FACTS.disambiguation}
`;
}

function getHomepageJson(): string {
  return JSON.stringify(
    {
      name: HOMEPAGE_FACTS.name,
      description: HOMEPAGE_FACTS.description,
      disambiguation: HOMEPAGE_FACTS.disambiguation,
      url: HOMEPAGE_FACTS.docsUrl,
      endpoints: Object.fromEntries(
        Object.entries(HOMEPAGE_FACTS.endpoints).map(([k, v]) => [
          k.toLowerCase().replace(/\W+/g, "_"),
          v,
        ]),
      ),
      features: HOMEPAGE_FACTS.features,
    },
    null,
    2,
  );
}

function getHomepageText(): string {
  const features = HOMEPAGE_FACTS.features
    .map((f) => `- ${f}`)
    .join("\n");
  const endpoints = Object.entries(HOMEPAGE_FACTS.endpoints)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `${HOMEPAGE_FACTS.name} — ${HOMEPAGE_FACTS.tagline}

${HOMEPAGE_FACTS.description}

Key Features:
${features}

Endpoints:
${endpoints}

Visit ${HOMEPAGE_FACTS.docsUrl} for full documentation.

Note: ${HOMEPAGE_FACTS.disambiguation}
`;
}

const SUPPORTED_TYPES = ["text/html", "text/markdown", "text/plain", "application/json"];

export function contentNegotiationMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // SLICE-259-16: HEAD negotiates identically to GET — same variant
    // headers, empty body (RFC 9110: HEAD ≡ GET without payload).
    const isHead = c.req.method === "HEAD";
    if (c.req.method !== "GET" && !isHead) {
      await next();
      return;
    }

    const accept = c.req.header("Accept");
    if (!accept || accept === "*/*") {
      await next();
      return;
    }

    // Only negotiate for the homepage path
    const path = new URL(c.req.url).pathname;
    if (path !== "/") {
      await next();
      return;
    }

    const type = pickMediaType(accept, SUPPORTED_TYPES);
    if (!type || type === "text/html") {
      // Route handler sets Vary: Accept directly
      await next();
      if (isHead) c.res = new Response(null, {
        status: c.res.status,
        headers: c.res.headers,
      });
      return;
    }

    const variant = (
      body: string,
      contentType: string,
    ): Response =>
      new Response(isHead ? null : body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Vary": "Accept",
        },
      });

    if (type === "text/markdown") {
      c.res = variant(getHomepageMarkdown(), "text/markdown; charset=utf-8");
      return;
    }

    if (type === "application/json") {
      c.res = variant(getHomepageJson(), "application/json; charset=utf-8");
      return;
    }

    if (type === "text/plain") {
      c.res = variant(getHomepageText(), "text/plain; charset=utf-8");
      return;
    }

    await next();
  };
}
