/**
 * EPIC-178 (SLICE-178-2): pure builders for the `.well-known` manifest set.
 * Zero IO — every value comes from `DiscoverySources` (collectSources is the
 * only impure edge). Registered in manifests.ts; routes/gen script are generic.
 *
 * Canonical specs (EPIC-178 §Каноническая спека, verified):
 * - agent-card.json        → A2A v1.0, `application/a2a+json` (agent-card.ts)
 * - api-catalog            → RFC 9727 linkset, `application/linkset+json` +
 *                            REQUIRED profile rfc9727
 * - erc8004-agent.json     → EIP-8004 registration-v1
 * - mcp/server-card.json   → MCP descriptor (AB-006 shape, tools introspected)
 * - oauth-protected-resource → RFC 9728
 * - security.txt           → RFC 9116, generated Expires (never hand-edited)
 * - did.json               → did:web document, gated by didEnabled (D-178-9)
 */

import type { DiscoverySources } from "./sources";

const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

// ─── api-catalog (RFC 9727 / RFC 9264 linkset) ───────────────────────────────

export function buildApiCatalog(src: DiscoverySources): string {
  const b = src.baseUrl;
  return json({
    linkset: [
      // Service root first — legacy tests index linkset[0] for
      // service-desc/service-doc/status.
      {
        anchor: `${b}/`,
        "service-desc": [
          { href: `${b}/api/specs`, type: "application/json" },
        ],
        "service-doc": [{ href: `${b}/docs`, type: "text/html" }],
        status: [{ href: `${b}/health`, type: "application/json" }],
      },
      {
        anchor: `${b}/.well-known/api-catalog`,
        item: [
          { href: `${b}/api/specs` },
          { href: `${b}/openapi.yaml` },
          { href: `${b}/api/v1/services` },
          { href: `${b}/docs` },
        ],
      },
      {
        anchor: `${b}/api/specs`,
        "service-desc": [
          { href: `${b}/api/specs`, type: "application/vnd.oai.openapi+json" },
        ],
        "service-doc": [{ href: `${b}/docs`, type: "text/html" }],
        status: [{ href: `${b}/api/health`, type: "application/json" }],
      },
      {
        anchor: `${b}/mcp`,
        "service-desc": [
          { href: `${b}/.well-known/mcp.json`, type: "application/json" },
          { href: `${b}/.well-known/mcp/server-card.json`, type: "application/json" },
        ],
      },
    ],
  });
}

// ─── erc8004-agent.json (EIP-8004 registration-v1) ───────────────────────────

export function buildErc8004Agent(src: DiscoverySources): string {
  const b = src.baseUrl;
  const e = src.wellKnownEnv?.erc8004 ?? {
    chainId: 5042,
    registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    agentId: "0",
  };
  return json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "AgentBadge",
    description:
      src.apiInfo?.description ??
      "Agent readiness scanner + x402 paid services on Arc",
    image: `${b}/icons/og-image.png`,
    services: [
      { name: "web", endpoint: b },
      {
        name: "A2A",
        endpoint: `${b}/.well-known/agent-card.json`,
        version: "1.0",
      },
      { name: "MCP", endpoint: `${b}/mcp`, version: "2025-06-18" },
      { name: "DID", endpoint: "did:web:agentbadge.xyz" },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    // EPIC-194-2: honest absence — emit no registration claim until
    // 194-3 registers on-chain and ERC8004_AGENT_ID is set to real id.
    registrations:
      e.agentId !== "0" && e.agentId !== ""
        ? [
          {
            agentId: e.agentId,
            agentRegistry: `eip155:${e.chainId}:${e.registry}`,
          },
        ]
        : [],
  });
}

// ─── mcp/server-card.json (AB-006 descriptor) ────────────────────────────────

export function buildMcpServerCard(src: DiscoverySources): string {
  const b = src.baseUrl;
  const mcp = src.mcpServer;
  return json({
    name: mcp?.name ?? "agentbadge",
    version: mcp?.version ?? src.apiInfo?.version ?? "0.0.0",
    description:
      "AgentBadge MCP server — namespaced endpoints for agent readiness",
    endpoint: `${b}/mcp`,
    transports: ["streamable-http"],
    remotes: [
      ...(mcp?.namespaces ?? []).map((ns) => ({
        name: ns.name,
        transport: "http",
        url: `${b}/mcp/${ns.name}`,
      })),
      { name: "all", transport: "http", url: `${b}/mcp` },
    ],
    namespaces: (mcp?.namespaces ?? []).map((ns) => ns.name),
    tools: mcp?.tools ?? [],
  });
}

// ─── oauth-protected-resource (RFC 9728) ─────────────────────────────────────

export function buildOauthProtectedResource(src: DiscoverySources): string {
  const b = src.baseUrl;
  return json({
    resource: b,
    authorization_servers: [`${b}/.well-known/oauth-authorization-server`],
    scopes_supported: ["read", "write", "admin"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${b}/auth.md`,
  });
}

// ─── security.txt (RFC 9116) ─────────────────────────────────────────────────

export function buildSecurityTxt(src: DiscoverySources): string {
  const now = src.now ?? new Date();
  const expires = new Date(now);
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  return [
    "Contact: mailto:support@agentbadge.xyz",
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${src.baseUrl}/.well-known/security.txt`,
    `Policy: ${src.baseUrl}/security`,
    "",
  ].join("\n");
}

// ─── did.json ────────────────────────────────────────────────────────────────
// Moved to ./did.ts (SLICE-178-7): buildDidWebDocument produces the full
// did:web document with verificationMethod/service[]/alsoKnownAs.
