/**
 * Shared harness for the agent-interaction MCP test suites
 * (mcp-agent-interaction{,-read,-write}.test.ts): route app, JSON-RPC
 * caller, store singleton and submit factories. Not a test file —
 * imported by the split suites.
 */
import { expect } from "vitest";
import { Hono } from "hono";

import { mcpAgentInteractionRoutes } from "../../src/server/routes/mcp-agent-interaction";
import { agentInteractionDescriptorRoutes } from "../../src/server/routes/well-known/agent-interaction-descriptor";
import { getDatabase } from "../../src/server/lib/database";
import { pickRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import { createAgentRequestRoutes } from "../../src/server/routes/agent-requests/agent-requests-api";
import { getConfig } from "../../src/config/env";
import type { SubmitInput } from "../../src/server/lib/request-inbox/store";

export const app = new Hono().route("/", mcpAgentInteractionRoutes);
export const manifestApp = new Hono().route("/", agentInteractionDescriptorRoutes);

export function rpc(
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
  headers: Record<string, string> = {},
) {
  return app.request("/mcp/agent-interaction", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

export const ROSTER = [
  "agentbadge_discover",
  "agentbadge_ask",
  "agentbadge_get_request_status",
  "agentbadge_create_task_request",
  "agentbadge_search_knowledge",
  "agentbadge_submit_feedback",
  "agentbadge_request_review",
  "agentbadge_report_problem",
];

// Handlers resolve the process-wide store singleton (memory mode in
// tests), so seeding via pickRequestInboxStores(getDatabase()) lands in
// the same map the tool dispatch reads.
export const stores = pickRequestInboxStores(getDatabase());

export const mkSubmit = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  id: `rq_${Math.random().toString(16).slice(2)}`,
  state: "submitted",
  kind: "question",
  payload: { prompt: "how do I verify a verdict?" },
  fingerprint: { ip: null, ua: "t/1", referer: null, src: null, headers: {} },
  fpHash: `fp_${Math.random().toString(16).slice(2)}`,
  expiresAtMs: Date.now() + 60_000,
  ...over,
});

export async function toolCall(name: string, args: Record<string, unknown>) {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    result: {
      isError: boolean;
      structuredContent: Record<string, unknown>;
    };
  };
}

// Raw caller for agentbadge_create_task_request (distinct UA per test so
// fresh fingerprint lanes don't collide inside the 1-per-2h budget).
export const createToolCall = (args: Record<string, unknown>, ua: string) =>
  rpc(
    "tools/call",
    { name: "agentbadge_create_task_request", arguments: args },
    1,
    { "user-agent": ua },
  );

// No lane overrides → the route wraps getSharedSubmitLanes() — the same
// bucket the tool's submitter uses (production topology).
export const restAppSharedLanes = () =>
  createAgentRequestRoutes({
    stores,
    env: {
      ...getConfig().requestInbox,
      fingerprintSalt: getConfig().requestInbox.fingerprintSalt,
    },
  });
