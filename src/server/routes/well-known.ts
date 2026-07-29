/**
 * Well-known routes — Agent Card + AI Sitemap
 *
 * SLICE-17-1: GET /.well-known/agent-card.json
 * SLICE-17-9: GET /ai-sitemap.xml
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { serverAgentCardSchema, openApiConfig } from "../openapi";

export const wellKnownRoutes = new Hono();

/**
 * Build the Server Agent Card from env + OpenAPI config.
 */
function buildAgentCard() {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";
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
    capabilities: [
      "passport_issuance",
      "passport_verification",
      "agent_directory",
      "a2a_messaging",
      "marketplace",
      "audit_trail",
      "did_resolution",
    ],
    skills: [
      "api_call",
      "payment",
      "data_provide",
      "data_consume",
      "orchestration",
    ],
    endpoints: {
      api: `${baseUrl}/api/specs`,
      docs: `${baseUrl}/docs`,
      mcp: `${baseUrl}/mcp`,
      llms_txt: `${baseUrl}/llms.txt`,
      guides: `${baseUrl}/agent-guide`,
      did_resolver: `${baseUrl}/did`,
    },
    payment: {
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
    },
  };
}

wellKnownRoutes.get(
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

/**
 * Build the AI sitemap XML string.
 * SLICE-17-9
 */
function buildAiSitemap(): string {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";

  const resources = [
    {
      loc: `${baseUrl}/.well-known/agent-card.json`,
      priority: "1.0",
      format: "json",
      desc: "Server Agent Card — machine-readable identity manifest",
    },
    {
      loc: `${baseUrl}/llms.txt`,
      priority: "1.0",
      format: "text",
      desc: "LLM-friendly API specification in plain text",
    },
    {
      loc: `${baseUrl}/api/specs`,
      priority: "1.0",
      format: "json",
      desc: "OpenAPI 3.1 specification",
    },
    {
      loc: `${baseUrl}/market/tasks`,
      priority: "0.7",
      format: "json",
      desc: "Marketplace task listings — browse available tasks",
    },
    {
      loc: `${baseUrl}/agent-guide`,
      priority: "0.9",
      format: "markdown",
      desc: "Agent onboarding guide: passport, directory, marketplace",
    },
    {
      loc: `${baseUrl}/market-guide`,
      priority: "0.8",
      format: "markdown",
      desc: "Marketplace guide: post, claim, deliver, complete tasks",
    },
    {
      loc: `${baseUrl}/medical-guide`,
      priority: "0.8",
      format: "markdown",
      desc: "Medical data skills guide",
    },
    {
      loc: `${baseUrl}/catalog`,
      priority: "0.8",
      format: "json",
      desc: "Tier pricing and capabilities catalog",
    },
    {
      loc: `${baseUrl}/agents`,
      priority: "0.8",
      format: "json",
      desc: "List all registered agents with active status",
    },
    {
      loc: `${baseUrl}/api/search`,
      priority: "0.7",
      format: "json",
      desc: "Unified search endpoint — find agents and tasks by query",
    },
  ];

  const entries = resources
    .map(
      (r) => `  <resource>
    <loc>${r.loc}</loc>
    <priority>${r.priority}</priority>
    <format>${r.format}</format>
    <desc>${r.desc}</desc>
  </resource>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<resources>
${entries}
</resources>`;
}

wellKnownRoutes.get(
  "/ai-sitemap.xml",
  describeRoute({
    tags: ["Discovery"],
    summary: "AI Sitemap (resource discovery map for AI agents)",
    description:
      "Returns an XML sitemap listing all machine-readable resources with priority, format, and description. Used by AI agents to discover available endpoints.",
    responses: {
      200: {
        description: "AI Sitemap XML",
        content: {
          "application/xml": {},
        },
      },
    },
  }),
  (c) => {
    const xml = buildAiSitemap();
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
