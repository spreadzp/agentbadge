import { Hono, type Context } from "hono";
import {
  handleHttpToolCall,
  listTools,
  handleHttpRequest,
  type ToolCallContext,
} from "@agentbadge/mcp";
import {
  resolveCallerTier,
  tierAllows,
  toolExposure,
  filterToolsByTier,
  deniedMessage,
  type CallerTier,
} from "../../lib/mcp-exposure";
export const mcpRoutes = new Hono();

// SSE transport: GET /mcp with Accept: text/event-stream
// SLICE-234-29: structured 406 contract — status unchanged, body now
// tells the client exactly what to send (transport 2025-06-18 keeps
// GET+SSE; the "GET→405" advice applies to a newer revision we don't run).
mcpRoutes.get("/mcp", (c) => {
  const accept = c.req.header("Accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    return c.json(
      {
        error: "not_acceptable",
        hint:
          "MCP speaks JSON-RPC over POST; GET here opens the SSE stream — " +
          "resend with Accept: text/event-stream.",
        requires: ["text/event-stream"],
        allowed_methods: ["GET", "POST"],
        documentation: "/agent-guide",
      },
      406,
    );
  }
  return new Response("event: ping\ndata: {}\n\n", {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// SLICE-234-29: explicit 405 for non-GET/POST methods — MUST be
// registered before mcpRoutes.all so DELETE/PUT/PATCH don't fall into
// the JSON-RPC catch-all (c.req.json() throws → handleHttpRequest →
// unpredictable SDK-transport response; DELETE /mcp ×7 in prod logs).
mcpRoutes.on(["DELETE", "PUT", "PATCH"], "/mcp", (c) =>
  c.json(
    {
      error: "method_not_allowed",
      allowed_methods: ["GET", "POST"],
      message:
        "MCP JSON-RPC requests must use HTTP POST; GET opens the SSE stream",
      documentation: "/agent-guide",
    },
    405,
    { Allow: "GET, POST" },
  ),
);

// EPIC-259 (SLICE-259-3): one exposure policy for every MCP entry point —
// single JSON-RPC, batch arrays, and the REST alias. tools/list and
// tools/call are dispatched here (never via the SDK transport), so a
// batch wrapper cannot reach a gated handler.
type RpcMessage = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, data } };
}

/** Verified caller context handed to tool handlers (SLICE-259-4). */
export function callerCtx(c: Context, tier: CallerTier): ToolCallContext {
  return {
    callerTier: tier,
    verifiedDid: c.get("verifiedDid") as string | undefined,
    agentId: c.get("agentId") as string | undefined,
  };
}

/** Shared tools/list + tools/call dispatcher over the default "all"
 *  registry — also used by the /mcp/ops operator surface (SLICE-259-5). */
export async function dispatchRpc(
  msg: RpcMessage,
  tier: CallerTier,
  ctx?: ToolCallContext,
): Promise<Record<string, unknown> | null> {
  const { id, method } = msg;

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: filterToolsByTier(listTools(), tier) },
    };
  }

  if (method === "tools/call") {
    const name = msg.params?.name;
    if (!name) {
      return rpcError(id, -32602, "Missing required parameter: name");
    }
    const exposure = toolExposure(name);
    if (!exposure) {
      return rpcError(id, -32601, `Tool not found: ${name}`);
    }
    if (!tierAllows(tier, exposure)) {
      return rpcError(id, -32001, deniedMessage(name, exposure), {
        required_tier: exposure,
        caller_tier: tier,
      });
    }
    const result = await handleHttpToolCall(name, msg.params?.arguments ?? {}, ctx);
    if (result.isError) {
      return rpcError(id, -32601, result.content[0]?.text ?? "Tool error");
    }
    return { jsonrpc: "2.0", id, result };
  }

  // Notifications carry no id and expect no response item.
  if (method && id === undefined) return null;

  return rpcError(id, -32601, `Method not found: ${method}`);
}

mcpRoutes.all("/mcp", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return handleHttpRequest(c.req.raw);
  }

  const tier = resolveCallerTier(c);
  const ctx = callerCtx(c, tier);

  // JSON-RPC 2.0 batch: every element is dispatched through the same
  // exposure gate — no delegation to the SDK transport (EPIC-259).
  if (Array.isArray(body)) {
    const replies = await Promise.all(
      (body as RpcMessage[]).map((msg) => dispatchRpc(msg, tier, ctx)),
    );
    return c.json(replies.filter((r): r is Record<string, unknown> => r !== null));
  }

  const msg = body as RpcMessage;
  const method = msg.method;
  const id = msg.id;

  if (method === "tools/list" || method === "tools/call") {
    const reply = await dispatchRpc(msg, tier, ctx);
    return c.json(reply);
  }

  if (method && method !== "initialize") {
    // Notifications (no id) get no response body per JSON-RPC 2.0.
    if (id === undefined) return c.body(null, 202);
    return c.json(rpcError(id, -32601, `Method not found: ${method}`));
  }

  // For initialize and non-JSON-RPC requests, delegate to SDK transport.
  // Reconstruct request with body since c.req.json() consumed it.
  const rawBody = JSON.stringify(body);
  const newRequest = new Request(c.req.url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: rawBody,
  });
  return handleHttpRequest(newRequest);
});

mcpRoutes.get("/mcp/tools", (c) => {
  const tier = resolveCallerTier(c);
  return c.json({ tools: filterToolsByTier(listTools(), tier) });
});

mcpRoutes.post("/mcp/tools/:toolName", async (c) => {
  const toolName = c.req.param("toolName");
  const tier = resolveCallerTier(c);

  const exposure = toolExposure(toolName);
  if (!exposure) {
    return c.json(
      {
        isError: true,
        content: [{ type: "text" as const, text: `Tool not found: ${toolName}` }],
      },
      404,
    );
  }
  if (!tierAllows(tier, exposure)) {
    return c.json(
      {
        isError: true,
        content: [{ type: "text" as const, text: deniedMessage(toolName, exposure) }],
        required_tier: exposure,
        caller_tier: tier,
      },
      403,
    );
  }

  let args: Record<string, unknown>;
  try {
    const body = await c.req.text();
    args = body ? JSON.parse(body) : {};
  } catch {
    const result = {
      isError: true,
      content: [{ type: "text" as const, text: "Malformed JSON body" }],
    };
    return c.json(result);
  }

  const result = await handleHttpToolCall(toolName, args, callerCtx(c, tier));
  return c.json(result);
});
