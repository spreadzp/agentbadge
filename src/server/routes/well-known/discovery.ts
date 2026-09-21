import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { BASE_URL } from "../../lib/page-meta";
import { buildDiscoveryJson, allTools } from "@agentbadge/webmcp";
import { MCP_NAMESPACES } from "./agent-card";

export const discoveryRoutes = new Hono();

// ─── WebMCP Discovery (SLICE-91-11) ──────────────────────────────

discoveryRoutes.get(
  "/.well-known/webmcp.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "WebMCP discovery document (declarative tool catalog)",
    description:
      "Returns the WebMCP discovery JSON listing all imperative tools available on the site. Enables AI agents to discover WebMCP tools via RFC 8615 well-known URI pattern.",
    responses: {
      200: {
        description: "WebMCP discovery JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                tools: z.array(
                  z.object({
                    name: z.string(),
                    description: z.string(),
                    inputSchema: z.object({
                      type: z.string(),
                      properties: z.record(z.string(), z.unknown()),
                      required: z.array(z.string()),
                    }),
                    annotations: z.object({
                      readOnlyHint: z.boolean(),
                      untrustedContentHint: z.boolean(),
                      title: z.string().optional(),
                    }),
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
    const discovery = buildDiscoveryJson(allTools);
    return c.json(discovery, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

// ─── OAuth Authorization Server Metadata (SLICE-47-3) ──────────

discoveryRoutes.get(
  "/.well-known/oauth-authorization-server",
  describeRoute({
    tags: ["Discovery"],
    summary: "OAuth authorization server metadata (MCP auth discovery)",
    description:
      "Returns OAuth 2.0 authorization server metadata per RFC 8414. Enables MCP clients to discover authentication requirements.",
    responses: {
      200: {
        description: "OAuth metadata JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                issuer: z.string(),
                authorization_endpoint: z.string(),
                token_endpoint: z.string(),
                registration_endpoint: z.string(),
                jwks_uri: z.string(),
                response_types_supported: z.array(z.string()),
                grant_types_supported: z.array(z.string()),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/auth/authorize`,
        token_endpoint: `${baseUrl}/auth/token`,
        registration_endpoint: `${baseUrl}/auth/register`,
        jwks_uri: `${baseUrl}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "client_credentials"],
        agent_auth: {
          register_uri: `${baseUrl}/auth.md`,
          supported_identity_types: ["did:hcs", "nft-passport"],
          credential_types: ["nft", "hcs-signed-message"],
          claims_endpoint: `${baseUrl}/passport`,
          revocation_endpoint: `${baseUrl}/passport/revoke`,
        },
      },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  },
);

// ─── skill.json (SLICE-121-6) ───────────────────────────────────

discoveryRoutes.get(
  "/skill.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent skill file (JSON-LD, machine-readable)",
    description:
      "Returns a JSON-LD representation of skill.md — machine-readable agent onboarding contract with capabilities, endpoints, auth, and payment info.",
    responses: {
      200: {
        description: "Skill JSON-LD",
        content: { "application/ld+json": {} },
      },
    },
  }),
  () => {
    const baseUrl = BASE_URL;
    const skill = {
      "@context": {
        "@vocab": "https://schema.org/",
        ab: "https://agentbadge.xyz/vocab#",
      },
      "@type": "SoftwareApplication",
      "@id": `${baseUrl}/skill.json`,
      name: "agentbadge",
      version: "1.0.0",
      format: "agentbadge-agent-v1",
      description:
        "AgentBadge gives AI agents on-chain identity via NFT passports on Hedera. Agents register, get DID, and transact on marketplace.",
      url: baseUrl,
      applicationCategory: "AIAgentPlatform",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free to use. Paid endpoints use x402 micropayments.",
      },
      "ab:capabilities": [
        "agent_identity",
        "passport_issuance",
        "agent_directory",
        "marketplace",
        "a2a_messaging",
        "micropayments",
        "compliance_checking",
        "capability_matching",
      ],
      "ab:endpoints": {
        api: `${baseUrl}/api/specs`,
        openapi_yaml: `${baseUrl}/openapi.yaml`,
        openapi_json: `${baseUrl}/openapi.json`,
        mcp: `${baseUrl}/mcp`,
        llms_txt: `${baseUrl}/llms.txt`,
        llms_full_txt: `${baseUrl}/llms-full.txt`,
        skill_md: `${baseUrl}/skill.md`,
        heartbeat_md: `${baseUrl}/heartbeat.md`,
        agent_card: `${baseUrl}/.well-known/agent-card.json`,
        ai_sitemap: `${baseUrl}/ai-sitemap.xml`,
        agent_guide: `${baseUrl}/agent-guide/context`,
      },
      "ab:auth": {
        type: "none",
        description:
          "No API key required. Paid endpoints use x402 (HTTP 402) payment flow. OAuth discovery at /.well-known/oauth-authorization-server.",
        oauth: `${baseUrl}/.well-known/oauth-authorization-server`,
      },
      "ab:payment": {
        protocol: "x402",
        description:
          "Paid endpoints return HTTP 402 with payment requirements. Agent constructs x402 payment header and retries.",
        spec: "https://x402.org",
        facilitator: `${baseUrl}/.well-known/x402.json`,
      },
      "ab:mcp_tools": [
        "request_passport",
        "verify_passport",
        "register_agent",
        "find_agents",
        "post_task",
        "claim_task",
        "deliver_result",
        "complete_task",
        "send_message",
        "get_inbox",
        "get_tier_requirements",
        "upgrade_tier",
      ],
      "ab:linked_files": [
        { file: "skill.md", url: `${baseUrl}/skill.md`, purpose: "Agent onboarding & skill definition" },
        { file: "llms.txt", url: `${baseUrl}/llms.txt`, purpose: "LLM-friendly API discovery" },
        { file: "openapi.yaml", url: `${baseUrl}/openapi.yaml`, purpose: "Full API contract (YAML)" },
        { file: "openapi.json", url: `${baseUrl}/openapi.json`, purpose: "Full API contract (JSON)" },
        { file: "mcp", url: `${baseUrl}/mcp`, purpose: "JSON-RPC over HTTP (MCP)" },
        { file: "agent-card.json", url: `${baseUrl}/.well-known/agent-card.json`, purpose: "Machine-readable agent identity" },
        { file: "heartbeat.md", url: `${baseUrl}/heartbeat.md`, purpose: "Periodic check-in routine" },
      ],
    };
    return new Response(JSON.stringify(skill, null, 2), {
      headers: {
        "Content-Type": "application/ld+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
      }
    });
  },
);

// ─── x402 payment discovery (SLICE-47-10) ──────────────────────

discoveryRoutes.get(
  "/.well-known/x402.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "x402 payment discovery",
    description:
      "Returns the site's x402 payment configuration: supported network, facilitator, payTo wallet, and list of paid services with pricing.",
    responses: {
      200: {
        description: "x402 payment configuration",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const facilitatorUrl = process.env.x402_FACILITATOR_URL ?? "https://facilitator-agentbadge.fly.dev";
    const payTo = process.env.x402_TREASURY ?? process.env.HEDERA_OPERATOR_ID ?? "0.0.5266613";
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    const networkId = network === "mainnet" ? "hedera:mainnet" : "hedera:testnet";

    const config = {
      x402Version: 1,
      name: "AgentBadge",
      network: networkId,
      facilitator: facilitatorUrl,
      payTo,
      services: [
        {
          method: "POST",
          path: "/passport/request",
          description: "Agent Passport NFT issuance (x402 payment required)",
          amount: {
            asset: "HBAR",
            unit: "tinybar",
            tiers: {
              bronze: "5000000",
              silver: "25000000",
              gold: "100000000",
              platinum: "500000000",
            },
          },
          mimeType: "application/json",
          extensions: {
            bazaar: {
              discoverable: true,
              category: "identity",
              tags: ["hedera", "nft", "passport", "agent-identity"],
            },
          },
        },
      ],
      extensions: {
        bazaar: {
          discoverable: true,
          provider: "AgentBadge",
          homepage: "https://agentbadge.xyz",
        },
      },
    };

    return c.json(config, 200, {
      "Cache-Control": "public, max-age=300",
    });
  },
);

// ─── WebMCP manifest (SLICE-47-12) ────────────────────────────

discoveryRoutes.get(
  "/.well-known/webmcp.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "WebMCP manifest",
    description: "Browser-accessible MCP tools manifest for Chrome WebMCP integration.",
    responses: {
      200: { description: "WebMCP manifest", content: { "application/json": {} } },
    },
  }),
  (c) => {
    const manifest = {
      name: "AgentBadge",
      version: "1.0.0",
      description: "On-chain identity for AI agents on Hedera — namespaced MCP endpoints",
      mcpEndpoint: "/mcp",
      namespaces: [...MCP_NAMESPACES],
      namespaceEndpoints: MCP_NAMESPACES.map((ns) => ({
        name: ns,
        url: `/mcp/${ns}`,
        descriptor: `/.well-known/${ns}-mcp.json`,
      })),
    };

    return c.json(manifest, 200, {
      "Cache-Control": "public, max-age=300",
    });
  },
);

// ─── SLICE-49-2: API Catalog (RFC 9727) ──────────────────────────

discoveryRoutes.get(
  "/.well-known/api-catalog",
  describeRoute({
    tags: ["Discovery"],
    summary: "API Catalog — RFC 9727 compliant linkset for API discovery",
    responses: {
      200: {
        description: "API catalog as application/linkset+json",
        content: { "application/linkset+json": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        linkset: [
          {
            anchor: `${baseUrl}/`,
            "service-desc": [
              { href: `${baseUrl}/api/specs`, type: "application/json" },
            ],
            "service-doc": [
              { href: `${baseUrl}/docs`, type: "text/html" },
            ],
            "status": [
              { href: `${baseUrl}/health`, type: "application/json" },
            ],
          },
          {
            anchor: `${baseUrl}/mcp`,
            "service-desc": [
              { href: `${baseUrl}/.well-known/mcp.json`, type: "application/json" },
            ],
          },
        ],
      },
      200,
      {
        "Content-Type": "application/linkset+json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-49-5: Agent Skills index ──────────────────────────────

discoveryRoutes.get(
  "/.well-known/agent-skills/index.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent Skills Discovery Index — RFC v0.2.0",
    responses: {
      200: {
        description: "Skills index JSON",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    const skills = [
      {
        name: "agent-readiness-scan",
        type: "text/markdown",
        description: "Scan any URL for agent readiness compliance",
        url: `${baseUrl}/skill.md`,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      {
        name: "passport-issuance",
        type: "application/json",
        description: "Issue agent passport NFTs on Hedera via x402 payment",
        url: `${baseUrl}/.well-known/agent-card.json`,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      {
        name: "marketplace-trading",
        type: "application/json",
        description: "Post, claim, deliver, and complete marketplace tasks on Hedera",
        url: `${baseUrl}/marketplace-guide`,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    ];
    return c.json(
      {
        $schema: "https://agentskills.io/schema/v0.2.0",
        skills,
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-49-7: Web Bot Auth directory ──────────────────────────

discoveryRoutes.get(
  "/.well-known/http-message-signatures-directory",
  describeRoute({
    tags: ["Discovery"],
    summary: "Web Bot Auth — JWKS for HTTP Message Signatures",
    responses: {
      200: {
        description: "JWKS JSON",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    return c.json(
      {
        keys: [
          {
            kty: "OKP",
            use: "sig",
            alg: "EdDSA",
            kid: "agentbadge-2026",
            crv: "Ed25519",
            x: "agentbadge.xyz",
          },
        ],
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);
