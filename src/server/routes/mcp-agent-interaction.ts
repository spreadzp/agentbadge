// EPIC-233 (SLICE-233-1, D-233-1): keyless agent-interaction MCP
// namespace — POST /mcp/agent-interaction.
//
// A foreign agent calls the 8 agentbadge_* interaction tools over plain
// JSON-RPC: discover capabilities, ask the QA corpus, submit async
// requests, poll for results, leave feedback. Source of truth for the
// roster is lib/agent-interaction/registry.ts (AGENT_INTERACTION_TOOLS)
// — an ISOLATED whitelist, not a filter over the internal toolset
// (mcp-public landmine precedent: write tools cannot exist in packages/mcp
// and accidentally leak here).
//
// Transport: plain JSON-RPC over JSON responses — single messages only,
// no batch arrays, no SSE, no mcp-session-id (stateless, D-233-1).
// Rate-limit + auth: NOT mounted here — the global mcpAbuseGuard on
// /mcp/* (wiring/mcp-abuse.ts) and global agentKeyAuth (index.ts)
// already cover this path; a second guard instance would double-count
// every request (arc-audit N-4). Unlike /mcp/public (auth IGNORED),
// Bearer agb_ is meaningful here: handlers see c.agentId for the keyed
// lane and write tools (D-233-6).
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";

import {
  AGENT_INTERACTION_MCP_PATH,
  AGENT_INTERACTION_PROTOCOL_VERSION,
  AGENT_INTERACTION_TOOLS,
  agentToolList,
  callAgentTool,
  resolveAgentToolContext,
} from "../lib/agent-interaction/registry";

export const mcpAgentInteractionRoutes = new Hono();

function toolResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
    isError,
  };
}

const rpcResult = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string() })
    .optional(),
});

// GET /mcp/agent-interaction — plain-JSON namespace descriptor.
mcpAgentInteractionRoutes.get(
  AGENT_INTERACTION_MCP_PATH,
  describeRoute({
    tags: ["MCP"],
    summary: "Agent-interaction MCP namespace info (keyless)",
    description:
      "Keyless agent-protocol endpoint info: protocol version, " +
      "transport, auth model and the agentbadge_* tool roster. POST " +
      "JSON-RPC to the same path. Capability manifest: " +
      "/.well-known/agent-interaction.json.",
    responses: {
      200: {
        description: "Namespace descriptor",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                name: z.string(),
                protocol_version: z.string(),
                transport: z.string(),
                auth: z.string(),
                tools: z.array(z.string()),
                manifest: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) =>
    c.json({
      name: "agentbadge-agent-interaction",
      protocol_version: AGENT_INTERACTION_PROTOCOL_VERSION,
      transport: "json-rpc-over-http (plain JSON, no SSE, no sessions)",
      auth: "none required; optional Bearer agb_ (keyed lane)",
      tools: AGENT_INTERACTION_TOOLS.map((t) => t.name),
      manifest: "/.well-known/agent-interaction.json",
    }),
);

// POST /mcp/agent-interaction — JSON-RPC: initialize / ping /
// tools/list / tools/call.
mcpAgentInteractionRoutes.post(
  AGENT_INTERACTION_MCP_PATH,
  describeRoute({
    tags: ["MCP"],
    summary: "Agent-interaction MCP JSON-RPC endpoint (keyless)",
    description:
      "JSON-RPC 2.0 over plain JSON responses. Methods: initialize, " +
      "ping, tools/list, tools/call. Roster: 8 agentbadge_* tools " +
      "(see /.well-known/agent-interaction.json). Single messages " +
      "only — no batch, no SSE, no mcp-session-id. Optional Bearer " +
      "agb_ elevates to the keyed lane (verified agentId).",
    responses: {
      200: {
        description: "JSON-RPC response envelope",
        content: { "application/json": { schema: resolver(rpcResult) } },
      },
    },
  }),
  async (c) => {
    let body: {
      method?: string;
      id?: unknown;
      params?: Record<string, unknown>;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }

    // D-233-1: stateless single-message transport — a batch wrapper
    // could smuggle call shapes the manifest does not describe.
    if (Array.isArray(body)) {
      return c.json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request: batch arrays are not supported",
        },
      });
    }

    const { method, id = null, params = {} } = body;
    const respond = (result: unknown) => c.json({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string, data?: unknown) =>
      c.json({ jsonrpc: "2.0", id, error: { code, message, data } });

    switch (method) {
      case "initialize":
        return respond({
          protocolVersion: AGENT_INTERACTION_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: {
            name: "agentbadge-agent-interaction",
            version: "1.0.0",
          },
        });
      case "ping":
        return respond({});
      case "notifications/initialized":
      case "initialized":
        return c.json({}, 202);
      case "tools/list":
        return respond({ tools: agentToolList() });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!name) return fail(-32602, "Missing required parameter: name");
        const called = await callAgentTool(
          name,
          params.arguments ?? {},
          resolveAgentToolContext(c),
        );
        if (called.ok) return respond(toolResult(called.data));
        // Whitelist boundary: names outside the registry are a
        // protocol error; registered-but-unwired tools answer a
        // tool-level structured error (isError) instead.
        if (called.error.code === "UNKNOWN_TOOL") {
          return fail(
            -32601,
            `Tool not found: ${name} (roster: ${AGENT_INTERACTION_TOOLS.map((t) => t.name).join(", ")})`,
          );
        }
        if (called.error.code === "INVALID_PARAMS") {
          return fail(-32602, called.error.message, called.error.data);
        }
        return respond(
          toolResult({ error: called.error }, /* isError */ true),
        );
      }
      default:
        return fail(-32601, `Method not found: ${method ?? "<missing>"}`);
    }
  },
);
