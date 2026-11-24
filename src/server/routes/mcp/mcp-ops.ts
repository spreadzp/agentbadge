/**
 * EPIC-259 (SLICE-259-5): operator MCP surface at /mcp/ops.
 *
 * Admin-exposure tools (revoke_passport, rebuild_cache,
 * circle_wallet_balance, payment_history, keeperhub-*, …) are operator
 * operations — they live behind an operator credential, on a
 * dedicated entry point instead of the public /mcp registry lens.
 *
 *   GET  /mcp/ops          — surface info + tool names
 *   GET  /mcp/ops/tools    — ToolListings for admin-exposure tools
 *   POST /mcp/ops          — JSON-RPC (tools/list → admin tools,
 *                            tools/call → dispatched as admin tier)
 *   POST /mcp/ops/tools/:name — REST alias, admin tier
 *
 * Public catalogs never list these tools (isPublicTool → exposure)
 * and anonymous/agb_ callers are filtered out by the SLICE-259-3
 * transport gate — this surface is how operators actually reach them.
 *
 * Adding a new ops tool: register it with { exposure: "admin" } —
 * it appears here automatically; nothing else to wire.
 */

import { Hono } from "hono";
import { listTools, handleHttpToolCall, type ToolCallContext } from "@agentbadge/mcp";
import { getDatabase } from "../../lib/database";
import { pickOperatorStores, type OperatorStore } from "../../lib/operators";
import { operatorAuth } from "../../middleware/operatorAuth";
import { capabilityGate } from "../../middleware/operator-gate";
import { toolExposure } from "../../lib/mcp-exposure";
import { dispatchRpc } from "./mcp";

// SLICE-264-8: operator credential — GETs need "read", POSTs
// "workflow" (capabilityForSurface verb split).
export function createMcpOpsRoutes(
  deps: { operatorStore?: OperatorStore } = {},
): Hono {
  const mcpOpsRoutes = new Hono();
  const opStore = deps.operatorStore ?? pickOperatorStores(getDatabase());

  // Everything below requires the operator credential.
  mcpOpsRoutes.use(operatorAuth(opStore), capabilityGate());

const adminCtx: ToolCallContext = { callerTier: "admin" };

  mcpOpsRoutes.get("/", (c) => {
    const adminTools = listTools().filter((t) => t.exposure === "admin");
    return c.json({
      surface: "ops",
      description:
        "Operator MCP surface — admin-exposure tools behind an operator " +
        "credential. Public/agent tools are served by /mcp and /mcp/<namespace>.",
      auth: "X-Admin-Key or Bearer <opk_ operator key>",
      tools: adminTools.map((t) => t.name),
    });
  });

  mcpOpsRoutes.get("/tools", (c) => {
    return c.json({
      tools: listTools().filter((t) => t.exposure === "admin"),
    });
  });

  mcpOpsRoutes.post("/tools/:toolName", async (c) => {
    const toolName = c.req.param("toolName");
    if (!toolExposure(toolName)) {
      return c.json(
        {
          isError: true,
          content: [{ type: "text" as const, text: `Tool not found: ${toolName}` }],
        },
        404,
      );
    }

    let args: Record<string, unknown>;
    try {
      const body = await c.req.text();
      args = body ? JSON.parse(body) : {};
    } catch {
      return c.json({
        isError: true,
        content: [{ type: "text" as const, text: "Malformed JSON body" }],
      });
    }

    const result = await handleHttpToolCall(toolName, args, adminCtx);
    return c.json(result);
  });

  type RpcMessage = {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };

  mcpOpsRoutes.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        400,
      );
    }

    // JSON-RPC dispatch at admin tier — tools/call reaches every tool,
    // tools/list returns the operator view (admin-exposure tools).
    if (Array.isArray(body)) {
      const replies = await Promise.all(
        (body as RpcMessage[]).map((msg) =>
          msg.method === "tools/list"
            ? {
                jsonrpc: "2.0" as const,
                id: msg.id,
                result: {
                  tools: listTools().filter((t) => t.exposure === "admin"),
                },
              }
            : dispatchRpc(msg, "admin", adminCtx),
        ),
      );
      return c.json(
        replies.filter((r): r is Record<string, unknown> => r !== null),
      );
    }

    const msg = body as RpcMessage;
    if (msg.method === "tools/list") {
      return c.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: { tools: listTools().filter((t) => t.exposure === "admin") },
      });
    }
    const reply = await dispatchRpc(msg, "admin", adminCtx);
    return c.json(reply);
  });

  return mcpOpsRoutes;
}
