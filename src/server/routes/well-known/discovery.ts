import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { BASE_URL } from "../../lib/page-meta";
import { buildDiscoveryJson, toolsFor } from "@agentbadge/webmcp";
import { serverMirrorTools } from "../../lib/agent-interaction/webmcp-page-tools";
import { MCP_NAMESPACES } from "./agent-card";
import { MARKETPLACE_LISTINGS } from "../../lib/agent-discovery/marketplace-listings";
import { aauthDiscoveryRoutes } from "./discovery-aauth";
import { x402DiscoveryRoutes } from "./discovery-x402";
import { internalRequest } from "../../middleware/markdown-negotiation-helpers";
import { didKeyMaterialFromEnv, DID_VM_FRAGMENT } from "../../lib/agent-discovery/did-key";
import { createHash } from "node:crypto";

export const discoveryRoutes = new Hono();

discoveryRoutes.route("/", aauthDiscoveryRoutes);
discoveryRoutes.route("/", x402DiscoveryRoutes);

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
                    group: z.string(),
                    exposure: z.string(),
                    writeClass: z.string(),
                    version: z.string(),
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
    const discovery = buildDiscoveryJson(toolsFor({ exposure: "webmcp" }));
    // SLICE-233-6: the /for-agents shelf carries two tools that live
    // server-side until the @agentbadge/webmcp package republishes
    // them — expose them in the discovery manifest + cross-link the
    // agent-interaction descriptor (single discovery entry point).
    const extra = buildDiscoveryJson(serverMirrorTools()).tools;
    return c.json(
      {
        ...discovery,
        tools: [...discovery.tools, ...extra],
        agentInteractionManifest: "/.well-known/agent-interaction.json",
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
        "AgentBadge is an agent-readiness scanner (USDC x402 on Arc) plus an agent identity + marketplace layer on EVM/Arc. Legacy Hedera testnet flows remain read-only.",
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
        type: "optional-api-key",
        description:
          "Anonymous calls work on the curated public surface (rate-limited per IP). A free agb_ key — POST /api/v1/agents/register, shown once — unlocks the full public+authenticated list via Authorization: Bearer agb_…. Paid endpoints use x402 (HTTP 402). OAuth discovery at /.well-known/oauth-authorization-server.",
        api_key: `POST ${baseUrl}/api/v1/agents/register`,
        oauth: `${baseUrl}/.well-known/oauth-authorization-server`,
      },
      "ab:payment": {
        protocol: "x402",
        description:
          "Paid endpoints return HTTP 402 with payment requirements. Agent constructs x402 payment header and retries.",
        spec: "https://x402.org",
        facilitator: `${baseUrl}/.well-known/x402.json`,
      },
      /** EPIC-242: external venues where the paid services are listed. */
      "ab:distribution": MARKETPLACE_LISTINGS,
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
      description: "On-chain identity for AI agents on EVM (Arc) — namespaced MCP endpoints (legacy: Hedera)",
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
  async (c) => {
    const baseUrl = BASE_URL;
    const skills = [
      {
        name: "agent-readiness-scan",
        type: "text/markdown",
        description: "Scan any URL for agent readiness compliance",
        url: `${baseUrl}/skill.md`,
        path: "/skill.md",
      },
      {
        name: "passport-issuance",
        type: "application/json",
        description: "Issue agent passport NFTs via x402 payment (USDC on Arc; legacy: Hedera)",
        url: `${baseUrl}/.well-known/agent-card.json`,
        path: "/.well-known/agent-card.json",
      },
      {
        name: "marketplace-trading",
        type: "application/json",
        description: "Post, claim, deliver, and complete marketplace tasks on Arc (USDC; legacy: Hedera)",
        url: `${baseUrl}/marketplace-guide`,
        path: "/marketplace-guide",
      },
    ];
    // SLICE-259-37: sha256 over the actual served bytes (self-fetch through
    // the late-bound app, memoized per process). All-zero placeholders lied
    // about integrity — now the field carries the real hash or is omitted.
    const hashes = await skillsHashes();
    return c.json(
      {
        $schema: "https://agentskills.io/schema/v0.2.0",
        skills: skills.map(({ path, ...rest }) => {
          const sha256 = hashes.get(path);
          return sha256 ? { ...rest, sha256 } : rest;
        }),
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// SLICE-259-37: lazily hash the three advertised skill artifacts through
// the assembled app — memoized per process, shared promise avoids
// stampede on first hit.
let skillsHashPromise: Promise<Map<string, string>> | null = null;
function skillsHashes(): Promise<Map<string, string>> {
  if (!skillsHashPromise) {
    skillsHashPromise = (async () => {
      const map = new Map<string, string>();
      for (const path of ["/skill.md", "/.well-known/agent-card.json", "/marketplace-guide"]) {
        const res = await internalRequest(path);
        if (res) {
          map.set(path, createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex"));
        }
      }
      return map;
    })().catch(() => new Map<string, string>());
  }
  return skillsHashPromise;
}

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
    // SLICE-259-38: serve the REAL DID key — the previous body shipped
    // "x":"agentbadge.xyz" (a hostname, not a base64url key), a cosmetic
    // trust signal in the same class as the zero-sha256 placeholders.
    const material = didKeyMaterialFromEnv();
    if (!material) return c.notFound();
    // SLICE-259-39 (DeepSeek ds15): kid must match jwks.json + did.json —
    // one key, one id across all three surfaces, or verifiers correlating
    // by kid resolve the same public key under two different identities.
    return c.json(
      {
        keys: [
          {
            ...material.publicJwk,
            kid: `did:web:${new URL(BASE_URL).host}${DID_VM_FRAGMENT}`,
            use: "sig",
            alg: "EdDSA",
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

// ─── SLICE-259-39: canonical agent entry point (Grok R4 proposal) ──
// One small file an agent can start from: free scan, first useful call,
// auth model, MCP endpoint — closes the manifest→action gap.
discoveryRoutes.get(
  "/.well-known/agent-start.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Canonical agent entry point — free scan, auth model, quickstart",
    responses: {
      200: {
        description: "Agent quickstart manifest",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const b = BASE_URL;
    return c.json(
      {
        version: "1.0",
        name: "AgentBadge",
        description:
          "Start here for AI agents: free readiness scan, badge, MCP tools, marketplace.",
        free_scan: `GET ${b}/api/scan?url={url}`,
        quickstart: [
          `GET ${b}/.well-known/agent-card.json`,
          `GET ${b}/llms.txt`,
          `GET ${b}/api/scan?url=https://example.com`,
          `POST ${b}/api/v1/agents/register — free agb_ API key (observer tier)`,
        ],
        auth_model: "aauth + x402 + did-signature + agb_ bearer",
        api_key_registration: `POST ${b}/api/v1/agents/register`,
        mcp: `${b}/mcp`,
        mcp_public: `${b}/mcp/public`,
        a2a: `${b}/a2a`,
        next: `${b}/agent-guide/getting-started`,
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-259-40 (AB-102): MCP ↔ REST parity map ──────────────
// Our MCP surface is intentionally curated (17 tools) while the REST
// surface is full (~320 paths) — checkers reading tool_count vs
// path_count as a coverage signal need the explicit mapping, not a
// silent gap. This document makes the curation declarative.
discoveryRoutes.get(
  "/.well-known/mcp-rest-mapping.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "MCP tool ↔ REST endpoint parity map",
    responses: {
      200: {
        description: "Tool-to-REST mapping",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const b = BASE_URL;
    return c.json(
      {
        schema: "agentbadge.mcp-rest-mapping.v1",
        policy:
          "MCP tools are a curated ergonomic layer, not a 1:1 mirror of the REST surface. Every agent action reachable via MCP has a REST equivalent; the remaining REST paths are human/operator surfaces deliberately not tool-shaped.",
        mcp_endpoint: `${b}/mcp`,
        mcp_public_endpoint: `${b}/mcp/public`,
        openapi: `${b}/api/specs`,
        mappings: [
          { tool: "scan_agent_readiness", rest: "GET /api/scan?url={url}", tier: "free" },
          { tool: "total_scan", rest: "POST /api/total-scan", tier: "x402" },
          { tool: "agent_register", rest: "POST /api/v1/agents/register", tier: "free" },
          { tool: "services_catalog", rest: "GET /api/v1/services", tier: "free" },
          { tool: "passport_lookup", rest: "GET /passport/{tokenId}/{serial}", tier: "free" },
          { tool: "did_resolve", rest: "GET /did/{did}", tier: "free" },
          { tool: "agents_lookup", rest: "GET /agents/{did}", tier: "free" },
          { tool: "a2a_send", rest: "POST /a2a/send", tier: "agb_ + EIP-191" },
          { tool: "a2a_inbox", rest: "GET /a2a/inbox", tier: "agb_" },
          { tool: "market_tasks", rest: "GET /market/tasks", tier: "free" },
          { tool: "market_claim", rest: "POST /market/tasks/{taskId}/claim", tier: "agb_ + EIP-191" },
          { tool: "board_claim", rest: "POST /api/board/cards/{cardId}/claim", tier: "agb_ + EIP-191" },
          { tool: "task_bid", rest: "POST /api/tasks/{taskId}/bids", tier: "sig-auth" },
          { tool: "verdict_eaas", rest: "POST /api/eaas/verdict", tier: "x402" },
          { tool: "scan_lite_demo", rest: "GET /api/v1/demo/scan-lite", tier: "x402" },
          { tool: "knowledge_context", rest: "GET /agent-guide/context", tier: "free" },
          { tool: "llms_summary", rest: "GET /llms.txt", tier: "free" },
        ],
        rest_only_note:
          "Admin, ops, and human-UI paths are intentionally excluded from MCP — see /api/specs for the full public REST contract.",
      },
      200,
      { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    );
  },
);
