/**
 * SLICE-78-3: Shared MCP JSON-RPC test helpers.
 *
 * Works with Hono app.request() — no running server needed.
 */

import { mcpRoutes } from "../../src/server/routes/mcp";
import {
  listTools,
  registerAllTools,
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../../src/mcp/compliance-tools";
import { registerParityTools } from "../../src/mcp/parity-tools";

// Ensure all MCP tools are registered before tests run.
// In the server, this happens in index.ts; here we register them
// so listTools() and tools/list return the full tool set.
let _registered = false;
function ensureRegistered() {
  if (_registered) return;
  registerAllTools();
  registerComplianceTools();
  registerParityTools();
  _registered = true;
}
ensureRegistered();

// Re-export mcpRoutes so tests that need direct route access get
// the same registered instance.
export { mcpRoutes };

/**
 * Make a JSON-RPC call to the MCP endpoint via Hono's in-process request.
 */
export async function mcpJsonRpc(
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await mcpRoutes.request("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * Get the list of all registered MCP tool names.
 */
export function getMcpToolNames(): string[] {
  return listTools().map((t) => t.name);
}

/**
 * Get the full list of registered MCP tools (name + description + schema).
 */
export function getMcpTools() {
  return listTools();
}

/**
 * Call a specific MCP tool via JSON-RPC tools/call.
 */
export async function mcpToolCall(
  name: string,
  args: Record<string, unknown> = {},
  id: number | string = 1,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return mcpJsonRpc("tools/call", { name, arguments: args }, id);
}

/**
 * Standard JSON-RPC error codes.
 */
export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
