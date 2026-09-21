import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { serverAgentCardSchema, openApiConfig } from "../../openapi";
import { BASE_URL } from "../../lib/page-meta";
import { getNamespace } from "@agentbadge/mcp";
import { agentCardAuthBlock } from "../../lib/did-auth-docs";

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

export const wellKnownRoutes = new Hono();

/**
 * Build the Server Agent Card from env + OpenAPI config.
 */

export function buildAgentCard() {
  const baseUrl = BASE_URL;
  const facilitatorUrl =
    process.env.x402_FACILITATOR_URL ??
    process.env.FACILITATOR_URL ??
    "https://api.testnet.blocky402.com";
  const network = process.env.HEDERA_NETWORK ?? "testnet";

  return {
    name: openApiConfig.info.title,
    description: openApiConfig.info.description,
    url: baseUrl,
    version: openApiConfig.info.version,
    documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
    capabilities: [
      "passport_issuance",
      "passport_verification",
      "agent_directory",
      "a2a_messaging",
      "marketplace",
      "audit_trail",
      "did_resolution",
      "compliance_checking",
      "agent_skills_discovery",
      "web_bot_auth",
      "agency_services",
      "work_requests",
      "demand_registry",
      "on_chain_scan_recording",
      "trust_badge_minting",
      "keeperhub_workflows",
      "cross_chain_task_verification",
      "attestcoin_protocol",
    ],
    skills: [
      "api_call",
      "payment",
      "data_provide",
      "data_consume",
      "orchestration",
      "compliance_checking",
      "agency_discovery",
      "capability_matching",
      "work_request_submission",
      "on_chain_recording",
      "cross_chain_verification",
    ],
    endpoints: {
      api: `${baseUrl}/api/specs`,
      docs: "https://agentbadge.gitbook.io/agentbadge-docs",
      documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
      mcp: `${baseUrl}/mcp`,
      gitbook_mcp: "https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp",
      llms_txt: `${baseUrl}/llms.txt`,
      llms_full_txt: `${baseUrl}/llms-full.txt`,
      guides: `${baseUrl}/agent-guide/context`,
      did_resolver: `${baseUrl}/did`,
      api_catalog: `${baseUrl}/.well-known/api-catalog`,
      oauth_protected_resource: `${baseUrl}/.well-known/oauth-protected-resource`,
      auth_md: `${baseUrl}/auth.md`,
      verification_md: `${baseUrl}/verification.md`,
      reputation_md: `${baseUrl}/reputation.md`,
      agent_skills: `${baseUrl}/.well-known/agent-skills/index.json`,
      web_bot_auth: `${baseUrl}/.well-known/http-message-signatures-directory`,
      http_message_signatures: `${baseUrl}/.well-known/http-message-signatures-directory`,
      agency_json: `${baseUrl}/agency.json`,
      services: `${baseUrl}/services`,
      team_capabilities: `${baseUrl}/agent-guide/team/capabilities`,
      heartbeat_md: `${baseUrl}/heartbeat.md`,
      skill_json: `${baseUrl}/skill.json`,
      team_capabilities_json: `${baseUrl}/agent-guide/team/capabilities.json`,
      team_services: `${baseUrl}/agent-guide/team/services`,
      team_availability: `${baseUrl}/agent-guide/team/availability`,
      team_contact: `${baseUrl}/agent-guide/team/contact`,
      team_match: `${baseUrl}/agent-guide/team/match`,
      work_requests: `${baseUrl}/api/work-requests`,
      demand_request: `${baseUrl}/api/demand/request`,
      agents_txt: `${baseUrl}/agents.txt`,
      keeperhub_scan: `${baseUrl}/api/keeperhub/scan`,
      audit_stream: `${baseUrl}/audit/stream`,
      audit_webhook: `${baseUrl}/audit/webhook`,
      attestcoin_tasks: `${baseUrl}/api/attestcoin/tasks`,
      attestcoin_verify: `${baseUrl}/api/attestcoin/verify`,
      attestcoin_demo: `${baseUrl}/hackathon/attestcoin`,
    },
    auth: agentCardAuthBlock(baseUrl),
    "ab:payment": {
      protocol: "x402",
      scheme: "exact",
      network: network === "mainnet" ? "hedera:mainnet" : "hedera:testnet",
      asset: "HBAR",
      facilitator: facilitatorUrl,
    },
    blockchain: {
      network,
      passport_token_id: process.env.PASSPORT_TOKEN_ID,
      directory_topic_id: process.env.DIRECTORY_TOPIC_ID,
      audit_topic_id: process.env.AUDIT_TOPIC_ID,
      multi_chain: {
        base_sepolia: {
          chain_id: 84532,
          contracts: {
            trust_registry: process.env.TRUST_REGISTRY_ADDRESS ?? "",
            trust_badge: process.env.TRUST_BADGE_ADDRESS ?? "",
            agent_passport: process.env.AGENT_PASSPORT_BASE_ADDRESS ?? "",
          },
          purpose: "On-chain scan recording, TrustBadge soulbound NFT, AgentPassport NFT via KeeperHub",
        },
        ethereum_sepolia: {
          chain_id: 11155111,
          contracts: {
            task_escrow: process.env.TASK_ESCROW_ADDRESS ?? "",
          },
          purpose: "Attestcoin cross-chain task posting",
        },
        creditcoin_testnet: {
          chain_id: 1023,
          contracts: {
            task_marketplace_asc: process.env.TASK_MARKETPLACE_ASC_ADDRESS ?? "",
            task_state: process.env.TASK_STATE_ADDRESS ?? "",
          },
          purpose: "Attestcoin cross-chain task verification and lifecycle",
        },
      },
    },
  };
}

agentCardRoutes.get(
  "/.well-known/agent-card.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Server Agent Card (machine-readable identity manifest)",
    description:
      "Returns the server's Agent Card — a JSON manifest describing capabilities, endpoints, payment, and blockchain config. Used by external agents for discovery.",
    responses: {
      200: {
        description: "Agent Card JSON",
        content: {
          "application/json": {
            schema: resolver(serverAgentCardSchema),
          },
        },
      },
    },
  }),
  (c) => {
    const card = buildAgentCard();
    return c.json(card, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

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
