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
import {
  DEFAULT_ANON_MAX,
  DEFAULT_HEAVY_MAX,
  DEFAULT_KEYED_MAX,
  DEFAULT_WINDOW_MS,
} from "../../middleware/mcp-abuse-guard";

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
    // Arc-audit M14 (233-10): numbers come from the guard's own
    // constants — a hand-written string here used to drift silently.
    rate_limits: {
      anon: `${DEFAULT_ANON_MAX} req/${DEFAULT_WINDOW_MS / 60_000}min per IP`,
      keyed: `${DEFAULT_KEYED_MAX} req/${DEFAULT_WINDOW_MS / 60_000}min per agent (Bearer agb_)`,
      heavy: `${DEFAULT_HEAVY_MAX} req/${DEFAULT_WINDOW_MS / 60_000}min per lane on rateClass=heavy tools`,
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
      // Arc-audit H4 (233-10): honest durability — delivery pipeline
      // IS live (SSRF-pinned, signed, bounded retries) but the outbox
      // is in-process memory until the @agentbadge/database republish
      // wires the Postgres adapter: a restart drops queued rows and
      // multi-replica drains independently.
      status: "degraded",
      durability:
        "in-process outbox — a restart loses queued (not yet " +
        "delivered) webhooks; durable adapter pending @agentbadge/" +
        "database republish",
      field: "callback_url",
      contract:
        "https-only URL validated at intake (SSRF guard + DNS pin); " +
        "on terminal state (completed|failed|expired) we POST " +
        "{request_id, state, response?} with X-AgentBadge-Signature " +
        "(HMAC-SHA256 over t.body), bounded exponential retries.",
      signature_header: "X-AgentBadge-Signature",
      // H1: per-request secret — returned once in the submit response
      // as webhook_secret; receivers verify with their own value.
      signing:
        "per-request whsec_ secret (HMAC-derived from request_id) — " +
        "returned as webhook_secret at submit; verify t.v1 over " +
        "'<t>.<raw-body>'",
    },
    discovery_refs: [
      "/.well-known/agent-card.json",
      "/.well-known/agentbadge-machine.json",
      "/llms.txt",
      "/agent-guide",
    ],
  } as const;
}
