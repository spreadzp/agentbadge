/**
 * EPIC-233 (SLICE-233-1, D-233-3): /.well-known/agent-interaction.json
 * capability manifest — GENERATED from AGENT_INTERACTION_TOOLS, never
 * hand-edited (hand-edited per-tool fields = drift bug; the registry is
 * the single source of truth for tools/list, this manifest and the
 * 233-8 parity tests).
 *
 * Contract per D-233-3:
 *   per-tool: name, status: live|planned, auth: none|agb_optional,
 *   rateClass: base|heavy, rest_equivalent, channel: mcp|webmcp
 *   plus: mcp_endpoint, webhooks (callback_url format + signature),
 *   discovery_refs.
 */

import {
  AGENT_INTERACTION_MANIFEST_PATH,
  AGENT_INTERACTION_MCP_PATH,
  AGENT_INTERACTION_PROTOCOL_VERSION,
  AGENT_INTERACTION_TOOLS,
} from "./registry";

export function buildAgentInteractionManifest() {
  return {
    name: "agentbadge-agent-interaction",
    version: "1",
    manifest: AGENT_INTERACTION_MANIFEST_PATH,
    protocol_version: AGENT_INTERACTION_PROTOCOL_VERSION,
    mcp_endpoint: AGENT_INTERACTION_MCP_PATH,
    transport: "json-rpc-over-http (plain JSON, no SSE, no sessions)",
    auth: {
      scheme: "keyless; optional Bearer agb_",
      bearer_format: "agb_<base64url-43>",
      note:
        "auth=none tools never need a key; agb_optional tools accept an " +
        "optional agb_ Bearer for the keyed lane (verified agentId). " +
        "agb_ never appears in page-context WebMCP (D-233-8).",
    },
    rate_limits: {
      anon: "60 req/min per IP",
      keyed: "120 req/min per agent (Bearer agb_)",
      heavy: "10 req/min per lane on rateClass=heavy tools",
    },
    tools: AGENT_INTERACTION_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      status: t.status,
      auth: t.auth,
      rateClass: t.rateClass,
      rest_equivalent: t.rest_equivalent,
      channel: [...t.channel],
    })),
    requests: {
      submit: "POST /api/requests",
      poll: "GET /api/requests/:id",
      states: ["submitted", "working", "completed", "failed", "expired"],
      rule: "id = capability — request status is only reachable by id",
    },
    webhooks: {
      status: "planned",
      field: "callback_url",
      contract:
        "https-only URL validated at intake (SSRF guard); on terminal " +
        "state (completed|failed|expired) we POST {request_id, state, " +
        "response?} with X-AgentBadge-Signature (HMAC-SHA256), bounded " +
        "exponential retries (D-233-5, O1/O2).",
      signature_header: "X-AgentBadge-Signature",
    },
    discovery_refs: [
      "/.well-known/agent-card.json",
      "/.well-known/agentbadge-machine.json",
      "/llms.txt",
      "/agent-guide",
    ],
  } as const;
}
