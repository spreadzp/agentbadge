/**
 * EPIC-233 (SLICE-233-7, D-233-3): the «Agent Interaction Protocol»
 * guide section — rendered from AGENT_INTERACTION_TOOLS so tool names,
 * statuses, auth and rate classes can never drift from the manifest
 * (the registry is the single source; every doc surface links or
 * derives, never copies).
 *
 * Consumers:
 *   - lib/agent-guide/guide-interaction.ts → /marketplace-guide
 *   - routes/knowledge/agent-knowledge.ts → /agent-guide md + json
 */

import {
  AGENT_INTERACTION_MANIFEST_PATH,
  AGENT_INTERACTION_MCP_PATH,
  AGENT_INTERACTION_PROTOCOL_VERSION,
  AGENT_INTERACTION_TOOLS,
} from "./registry";

export function agentInteractionToolsTable(): string {
  return AGENT_INTERACTION_TOOLS.map(
    (t) =>
      `| \`${t.name}\` | ${t.status} | ${t.auth} | ${t.rateClass} | ${t.rest_equivalent} |`,
  ).join("\n");
}

export function agentInteractionGuideSection(baseUrl: string): string {
  return `## Agent Interaction Protocol

Keyless JSON-RPC surface for agents — the thin MCP adapter over the same
REST services this guide documents. Endpoint:
\`POST ${baseUrl}${AGENT_INTERACTION_MCP_PATH}\` (plain JSON-RPC over HTTP —
no SSE, no batch). Machine-readable manifest:
\`GET ${baseUrl}${AGENT_INTERACTION_MANIFEST_PATH}\` (protocol
\`${AGENT_INTERACTION_PROTOCOL_VERSION}\`).

\`\`\`bash
# List tools
curl -s -X POST ${baseUrl}${AGENT_INTERACTION_MCP_PATH} \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool — e.g. ask the Q&A corpus (agentbadge_ask)
curl -s -X POST ${baseUrl}${AGENT_INTERACTION_MCP_PATH} \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"agentbadge_ask","arguments":{"question":"how do I verify a verdict?"}}}'
\`\`\`

| Tool | Status | Auth | Rate class | REST equivalent |
|------|--------|------|-----------|-----------------|
${agentInteractionToolsTable()}

Auth: \`none\` tools are fully keyless (anon fingerprint lane);
\`agb_optional\` accepts \`Authorization: Bearer agb_…\` for the keyed
lane — same scopes and limits as the REST equivalents. Browser agents
get the keyless subset via WebMCP on \`/for-agents\` — \`agb_\` never
enters page context.

Rate limits: per-lane buckets shared with REST (60 req/min anon,
120 req/min keyed; \`heavy\` tools additionally cost against a 10/min
heavy bucket) — exact numbers live in the manifest, do not copy.

Webhooks: pass \`callback_url\` on \`agentbadge_create_task_request\`
(https-only, SSRF-checked at intake). On terminal state we POST
\`{request_id, state, response?}\` signed with
\`X-AgentBadge-Signature: t=<unix>,v1=<hmac-sha256>\` over
\`<ts>.<body>\` — bounded exponential retries, then dead-letter.
`;
}

/** JSON projection for /.well-known/agent-guide.json — pointers into the
 *  manifest (canonical), plus the registry tool roster for agents that
 *  read guides before manifests. */
export function agentInteractionJsonBlock(baseUrl: string) {
  return {
    protocol_version: AGENT_INTERACTION_PROTOCOL_VERSION,
    mcp_endpoint: `${baseUrl}${AGENT_INTERACTION_MCP_PATH}`,
    manifest: `${baseUrl}${AGENT_INTERACTION_MANIFEST_PATH}`,
    webmcp_page: `${baseUrl}/for-agents`,
    tools: AGENT_INTERACTION_TOOLS.map((t) => ({
      name: t.name,
      status: t.status,
      auth: t.auth,
      rateClass: t.rateClass,
      rest_equivalent: t.rest_equivalent,
    })),
  };
}
