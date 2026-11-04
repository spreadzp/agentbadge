// EPIC-206 (SLICE-206-4, D-206-1): keyless public MCP facade /mcp/public.
//
// A foreign agent connects and reads open tasks with read-only tools —
// the SaSame "magic entrance" pattern on our namespace. Source of truth
// is the 206-3 public read layer (direct lib calls, no HTTP loopback).
//
// Isolation decision (landmine): PUBLIC_TOOLS is a separate whitelist
// object, not a filter over the internal toolset — write tools cannot
// exist here even by configuration error.
//
// Transport: plain JSON-RPC over JSON responses (their SSE friction is
// deliberately not copied). No mcp-session-id — keyless means stateless.
// Rate-limit: covered by the global mcpAbuseGuard mounted on /mcp/* in
// wiring (anon lane); NOT re-mounted here — a second instance would
// double-count every request (arc-audit N-4).
// Auth decision (AC #4): auth headers are IGNORED — callers may probe
// with their usual client config; ignoring is the friendlier keyless
// contract (documented, not an accident).
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { getActiveTasks, getTaskById } from "@agentbadge/passport";
import {
  publicTaskDetail,
  publicTaskStatus,
  publicTaskSummary,
  startHerePayload,
} from "../lib/tasks/public-read";

export const mcpPublicRoutes = new Hono();

const PROTOCOL_VERSION = "2025-03-26"; // MCP spec version we answer

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Read-only whitelist — open marketplace tasks, nothing else. */
const PUBLIC_TOOLS: ToolDef[] = [
  {
    name: "open_tasks",
    description:
      "List open marketplace tasks: budget, derived budget_status " +
      "(DECLARED_NOT_RESERVED | ESCROWED | PAID), deadline, required " +
      "capabilities. Zero-budget tasks are reputation-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_task",
    description:
      "Full public projection of one task: description (acceptance " +
      "criteria) plus machine_entry — concrete calls with the task id.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "task_status",
    description: "Lightweight lifecycle + budget_status probe for a task.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "start_here",
    description:
      "Entry point: protocol descriptor URL, open-task count, first " +
      "call to make, and the write-auth scheme (sig-auth headers).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
    isError: false as const,
  };
}

function callPublicTool(
  name: string,
  args: Record<string, unknown>,
): { ok: true; result: unknown } | { ok: false; message: string } {
  const openTasks = () =>
    getActiveTasks().filter((t) => t.status === "posted");

  switch (name) {
    case "open_tasks": {
      const tasks = openTasks().map(publicTaskSummary);
      return { ok: true, result: toolResult({ tasks, count: tasks.length }) };
    }
    case "get_task": {
      const id = typeof args.task_id === "string" ? args.task_id : "";
      const t = id ? getTaskById(id) : null;
      if (!t) return { ok: false, message: `task not found: ${id || "<missing task_id>"}` };
      return { ok: true, result: toolResult(publicTaskDetail(t)) };
    }
    case "task_status": {
      const id = typeof args.task_id === "string" ? args.task_id : "";
      const t = id ? getTaskById(id) : null;
      if (!t) return { ok: false, message: `task not found: ${id || "<missing task_id>"}` };
      return { ok: true, result: toolResult(publicTaskStatus(t)) };
    }
    case "start_here":
      return { ok: true, result: toolResult(startHerePayload(openTasks().length)) };
    default:
      return {
        ok: false,
        message: `unknown tool: ${name} (read-only whitelist: ${PUBLIC_TOOLS.map((t) => t.name).join(", ")})`,
      };
  }
}

const rpcResult = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string() })
    .optional(),
});

// GET /mcp/public — plain-JSON discovery (no SSE requirement, no session).
mcpPublicRoutes.get(
  "/mcp/public",
  describeRoute({
    tags: ["MCP"],
    summary: "Public MCP facade info (keyless)",
    description:
      "Keyless read-only MCP endpoint info: protocol version, transport, " +
      "and the whitelist of read tools. POST JSON-RPC to the same path.",
    responses: {
      200: {
        description: "Facade descriptor",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                name: z.string(),
                protocol_version: z.string(),
                transport: z.string(),
                auth: z.string(),
                tools: z.array(z.string()),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) =>
    c.json({
      name: "agentbadge-market-public",
      protocol_version: PROTOCOL_VERSION,
      transport: "json-rpc-over-http (plain JSON, no SSE, no sessions)",
      auth: "none — read-only whitelist",
      tools: PUBLIC_TOOLS.map((t) => t.name),
    }),
);

// POST /mcp/public — JSON-RPC: initialize / tools/list / tools/call.
mcpPublicRoutes.post(
  "/mcp/public",
  describeRoute({
    tags: ["MCP"],
    summary: "Public MCP JSON-RPC endpoint (keyless, read-only)",
    description:
      "JSON-RPC 2.0 over plain JSON responses. Methods: initialize, " +
      "tools/list, tools/call. Whitelist: open_tasks, get_task, " +
      "task_status, start_here. No auth headers required; any supplied " +
      "auth headers are ignored. No mcp-session-id (stateless).",
    responses: {
      200: {
        description: "JSON-RPC response envelope",
        content: { "application/json": { schema: resolver(rpcResult) } },
      },
    },
  }),
  async (c) => {
    let body: { method?: string; id?: unknown; params?: Record<string, unknown> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    }

    const { method, id = null, params = {} } = body;
    const respond = (result: unknown) => c.json({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) =>
      c.json({ jsonrpc: "2.0", id, error: { code, message } });

    switch (method) {
      case "initialize":
        return respond({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "agentbadge-market-public", version: "1.0.0" },
        });
      case "notifications/initialized":
      case "initialized":
        return c.json({}, 202);
      case "tools/list":
        return respond({ tools: PUBLIC_TOOLS });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!name) return fail(-32602, "Missing required parameter: name");
        const args =
          typeof params.arguments === "object" && params.arguments !== null
            ? (params.arguments as Record<string, unknown>)
            : {};
        const called = callPublicTool(name, args);
        if (!called.ok) return fail(-32601, called.message);
        return respond(called.result);
      }
      default:
        return fail(-32601, `Method not found: ${method ?? "<missing>"}`);
    }
  },
);
