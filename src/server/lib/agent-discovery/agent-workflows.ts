/**
 * SLICE-259-18: /.well-known/agent-workflows.json — versioned workflow
 * contract (v1). Agent-facing executable recipes: each workflow binds a
 * REAL endpoint so an agent can run discover → execute → inspect →
 * verify → act without a human (or with an explicit approval gate for
 * requires_human).
 *
 * Distinct from /.well-known/webmcp.json: webmcp describes the in-browser
 * tool surface for a loaded page; this contract describes server-side
 * HTTP workflows for standalone agents — different consumers.
 */
import type { DiscoverySources } from "./sources";

export type WorkflowAutonomy = "autonomous" | "conditional" | "requires_human";

export interface WorkflowError {
  code: string;
  http: number;
  retryable: boolean;
}

export interface AgentWorkflow {
  id: string;
  name: string;
  description: string;
  /** How the agent discovers the capability/price/schema before calling. */
  discovery: { endpoint: string; method: "GET" | "POST"; protocol: string };
  preconditions: {
    authentication: string;
    permissions: string[];
    ownership_required: boolean;
  };
  input: { content_type: string; schema$ref: string };
  execution: {
    method: "GET" | "POST";
    endpoint: string;
    async: boolean;
    idempotency: "idempotent" | "none";
  };
  inspection: { response_schema: string; result_fields: string[] };
  verification: { method: string; endpoint?: string; success_conditions: string[] };
  autonomy: WorkflowAutonomy;
  /** Present iff autonomy === "requires_human". */
  approval?: { required_for: string; resume_after_approval: string };
  next_actions: string[];
  errors: WorkflowError[];
}

/**
 * Probe expectations for the CI contract↔routing check. Keyed by workflow
 * id — kept OUT of the published JSON (transport detail, not contract).
 * expectedStatuses: a response in this set proves the route is mounted;
 * envGated: route mounts only with the payments runtime (404 tolerated
 * in tests, still asserted if reachable).
 */
export const WORKFLOW_PROBES: Record<
  string,
  { method: "GET" | "POST"; path: string; expectedStatuses: number[]; envGated?: boolean }
> = {
  "website-scan": { method: "POST", path: "/api/total-scan", expectedStatuses: [400, 401, 402] },
  "passport-verify": { method: "GET", path: "/passport/__probe__/notanumber", expectedStatuses: [400] },
  "knowledge-search": { method: "GET", path: "/api/v1/agent/knowledge/search", expectedStatuses: [400] },
  "x402-paid-call": { method: "GET", path: "/api/v1/demo/scan-lite", expectedStatuses: [400, 402, 404], envGated: true },
  "agent-register": { method: "POST", path: "/api/v1/agents/register", expectedStatuses: [400, 503] },
};

// Contract bodies extracted to ./agent-workflows-contracts (300-line cap).
export { agentWorkflows } from "./agent-workflows-contracts";
import { agentWorkflows } from "./agent-workflows-contracts";
export function buildAgentWorkflows(src: DiscoverySources): string {
  return JSON.stringify(
    {
      schema_version: "1",
      name: "AgentBadge agent workflows",
      description:
        "Versioned workflow contract — executable recipes binding real " +
        "endpoints (discover → execute → inspect → verify → act). " +
        "See-also: /.well-known/webmcp.json describes the in-browser tool " +
        "surface — different consumer, same capabilities.",
      base_url: src.baseUrl,
      contract_note:
        "endpoints are absolute; {param} placeholders must be substituted. " +
        "All error bodies follow {error, code, retryable?, hint?}.",
      workflows: agentWorkflows(src),
      links: {
        agent_card: `${src.baseUrl}/.well-known/agent-card.json`,
        openapi: `${src.baseUrl}/api/specs`,
        pricing: `${src.baseUrl}/pricing.json`,
        webmcp: `${src.baseUrl}/.well-known/webmcp.json`,
      },
    },
    null,
    2,
  );
}
