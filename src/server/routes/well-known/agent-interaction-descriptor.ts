// EPIC-233 (SLICE-233-1, D-233-3): agent-interaction capability
// manifest — /.well-known/agent-interaction.json. Tells a foreign agent
// WHICH tools exist, their status (live|planned), auth model, rate
// class and REST equivalent — plus the mcp endpoint, webhook contract
// and discovery cross-refs.
//
// The document is generated from AGENT_INTERACTION_TOOLS
// (lib/agent-interaction/registry.ts → manifest.ts) — the SAME module
// that serves tools/list on /mcp/agent-interaction. Hand-editing any
// per-tool field here would be a drift bug; add/change tools in the
// registry instead.
// Keyless read: open CORS (global), cacheable — versioned via `version`.
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import { buildAgentInteractionManifest } from "../../lib/agent-interaction/manifest";

export const agentInteractionDescriptorRoutes = new Hono();

const toolShape = z.object({
  name: z.string(),
  description: z.string(),
  status: z.enum(["live", "planned"]),
  auth: z.enum(["none", "agb_optional"]),
  rateClass: z.enum(["base", "heavy"]),
  rest_equivalent: z.string(),
  channel: z.array(z.enum(["mcp", "webmcp"])),
});

const manifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  manifest: z.string(),
  protocol_version: z.string(),
  mcp_endpoint: z.string(),
  transport: z.string(),
  auth: z.object({
    scheme: z.string(),
    bearer_format: z.string(),
    note: z.string(),
  }),
  rate_limits: z.object({
    anon: z.string(),
    keyed: z.string(),
    heavy: z.string(),
  }),
  tools: z.array(toolShape),
  requests: z.object({
    submit: z.string(),
    poll: z.string(),
    states: z.array(z.string()),
    rule: z.string(),
  }),
  webhooks: z.object({
    status: z.string(),
    field: z.string(),
    contract: z.string(),
    signature_header: z.string(),
  }),
  discovery_refs: z.array(z.string()),
});

agentInteractionDescriptorRoutes.get(
  "/.well-known/agent-interaction.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent-interaction capability manifest (generated)",
    description:
      "Machine-readable capability manifest for the keyless agent " +
      "protocol surface: the 8 agentbadge_* MCP tools with status " +
      "(live|planned), auth (none|agb_optional), rateClass " +
      "(base|heavy), REST equivalents and channel (mcp|webmcp); the " +
      "JSON-RPC endpoint; the callback_url webhook contract; and " +
      "discovery cross-references. Generated from the tool registry " +
      "— identical roster as tools/list on POST /mcp/agent-interaction.",
    responses: {
      200: {
        description: "Agent-interaction manifest JSON",
        content: {
          "application/json": { schema: resolver(manifestSchema) },
        },
      },
    },
  }),
  (c) =>
    c.json(buildAgentInteractionManifest(), 200, {
      // Generated doc — cacheable; roster/status bump changes content.
      "Cache-Control": "public, max-age=3600",
    }),
);
