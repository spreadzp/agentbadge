/**
 * Content negotiation middleware — SLICE-47-4
 *
 * Inspects Accept header and returns appropriate Content-Type
 * for GET requests to HTML pages. Supports text/markdown, application/json,
 * text/plain, and text/html per RFC 9110 §12.5.1.
 */
import type { Context, Next } from "hono";

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

function getHomepageMarkdown(): string {
  return `# AgentBadge — Agent Readiness Platform

AgentBadge is an agent passport and readiness platform built on Hedera.
It provides MCP tools for agent identity, verification, marketplace tasks,
and agent-to-agent messaging.

## Key Features

- Agent Passports (NFT-based identity on Hedera)
- MCP Server with 21+ tools
- Agent Directory (HCS-based)
- Marketplace with escrow
- A2A messaging
- Audit trail on-chain

## Endpoints

- MCP: /mcp
- llms.txt: /llms.txt
- Agent Card: /.well-known/agent-card.json
- OpenAPI: /api/specs
- AI Sitemap: /ai-sitemap.xml

## Quick Start

\`\`\`bash
# Scan any URL for agent readiness
npx agentbadge scan https://example.com

# Connect via MCP
# Endpoint: https://agentbadge.xyz/mcp
\`\`\`

Visit https://agentbadge.xyz for full documentation.
`;
}

function getHomepageJson(): string {
  return JSON.stringify({
    name: "AgentBadge",
    description: "Agent passport and readiness platform built on Hedera",
    url: "https://agentbadge.xyz",
    endpoints: {
      mcp: "/mcp",
      llms_txt: "/llms.txt",
      agent_card: "/.well-known/agent-card.json",
      openapi: "/api/specs",
      ai_sitemap: "/ai-sitemap.xml",
    },
    features: [
      "Agent Passports (NFT-based identity on Hedera)",
      "MCP Server with 21+ tools",
      "Agent Directory (HCS-based)",
      "Marketplace with escrow",
      "A2A messaging",
      "Audit trail on-chain",
    ],
  }, null, 2);
}

function getHomepageText(): string {
  return `AgentBadge — Agent Readiness Platform

AgentBadge is an agent passport and readiness platform built on Hedera.
It provides MCP tools for agent identity, verification, marketplace tasks,
and agent-to-agent messaging.

Key Features:
- Agent Passports (NFT-based identity on Hedera)
- MCP Server with 21+ tools
- Agent Directory (HCS-based)
- Marketplace with escrow
- A2A messaging
- Audit trail on-chain

Endpoints:
- MCP: /mcp
- llms.txt: /llms.txt
- Agent Card: /.well-known/agent-card.json
- OpenAPI: /api/specs
- AI Sitemap: /ai-sitemap.xml

Visit https://agentbadge.xyz for full documentation.
`;
}

const SUPPORTED_TYPES = ["text/html", "text/markdown", "text/plain", "application/json"];

export function contentNegotiationMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.method !== "GET") {
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
      return;
    }

    if (type === "text/markdown") {
      return c.body(getHomepageMarkdown(), 200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Vary": "Accept",
      });
    }

    if (type === "application/json") {
      return c.body(getHomepageJson(), 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Vary": "Accept",
      });
    }

    if (type === "text/plain") {
      return c.body(getHomepageText(), 200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Vary": "Accept",
      });
    }

    await next();
  };
}
