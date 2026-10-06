import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { openApiConfig } from "../../openapi";
import { BASE_URL } from "../../lib/page-meta";
import { getNamespace } from "@agentbadge/mcp";

export const agentCardRoutes = new Hono();

export const MCP_NAMESPACES = ["passport", "market", "discovery", "audit"] as const;

const NAMESPACE_DESCRIPTIONS: Record<string, string> = {
  passport: "Agent identity, signing, and escrow tools",
  market: "Marketplace and dataset tools",
  discovery: "Agent directory, guide, A2A messaging, and discovery tools",
  audit: "Audit catalog, compliance checking, and OpenAPI parity tools",
};

function buildNamespaceDescriptor(nsName: string) {
  const ns = getNamespace(nsName);
  const tools = ns ? ns.listTools().map((t) => ({ name: t.name, description: t.description })) : [];
  return {
    name: `${nsName}-mcp`,
    version: openApiConfig.info.version,
    description: NAMESPACE_DESCRIPTIONS[nsName] ?? `${nsName} MCP namespace`,
    remotes: [
      {
        name: nsName,
        transport: "http",
        url: `${BASE_URL}/mcp/${nsName}`,
      },
    ],
    tools,
  };
}

// ─── Agent Card moved to lib/agent-discovery (SLICE-178-2). ───
// Served by discoveryManifestRoutes from MANIFEST_REGISTRY.

// ─── MCP Server Descriptor (SLICE-44-6 / AB-006) ──────────────────

agentCardRoutes.get(
  "/.well-known/mcp.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "MCP server descriptor (machine-readable MCP discovery)",
    description:
      "Returns the MCP server descriptor JSON, enabling AI agents to discover and connect to the AgentBadge MCP server programmatically.",
    responses: {
      200: {
        description: "MCP server descriptor JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                name: z.string(),
                version: z.string(),
                description: z.string(),
                remotes: z.array(
                  z.object({
                    name: z.string(),
                    transport: z.string(),
                    url: z.string(),
                  }),
                ),
                tools: z.array(
                  z.object({
                    name: z.string(),
                    description: z.string(),
                  }),
                ),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    const descriptor = {
      name: "agentbadge",
      version: openApiConfig.info.version,
      description: "AgentBadge MCP server — namespaced endpoints for agent readiness",
      remotes: [
        ...MCP_NAMESPACES.map((ns) => ({
          name: ns,
          transport: "http",
          url: `${baseUrl}/mcp/${ns}`,
        })),
        {
          name: "all",
          transport: "http",
          url: `${baseUrl}/mcp`,
        },
      ],
      namespaces: [...MCP_NAMESPACES],
    };
    return c.json(descriptor, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

// ─── Per-namespace MCP descriptors (SLICE-72-8) ─────────────────

MCP_NAMESPACES.forEach((nsName) => {
  agentCardRoutes.get(`/.well-known/${nsName}-mcp.json`, (c) => {
    const descriptor = buildNamespaceDescriptor(nsName);
    return c.json(descriptor, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  });
});
