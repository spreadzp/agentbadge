import { Hono, type Context } from "hono";
import { getNamespace, type ToolResult, type ToolCallContext } from "@agentbadge/mcp";
import {
  resolveCallerTier,
  tierAllows,
  toolExposure,
  filterToolsByTier,
  deniedMessage,
  type CallerTier,
} from "../../lib/mcp-exposure";
/** Verified caller context handed to tool handlers (SLICE-259-4). */
function callerCtx(c: Context, tier: CallerTier): ToolCallContext {
  return {
    callerTier: tier,
    verifiedDid: c.get("verifiedDid") as string | undefined,
    agentId: c.get("agentId") as string | undefined,
  };
}

// EPIC-259 (SLICE-259-3): same exposure policy as /mcp — tools/list and
// tools/call are dispatched here (never via the SDK transport), including
// JSON-RPC batch arrays.
type RpcMessage = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, data } };
}

export function createNamespaceRoutes(namespaceName: string): Hono {
  const routes = new Hono();
  const ns = getNamespace(namespaceName);

  if (!ns) {
    routes.all("/*", (c) =>
      c.json({ error: `Namespace '${namespaceName}' not found` }, 503),
    );
    return routes;
  }

  async function dispatchRpc(
    msg: RpcMessage,
    tier: CallerTier,
    c: Context,
  ): Promise<Record<string, unknown> | null> {
    const { id, method } = msg;

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: filterToolsByTier(ns!.listTools(), tier) },
      };
    }

    if (method === "tools/call") {
      const name = msg.params?.name;
      if (!name) {
        return rpcError(id, -32602, "Missing required parameter: name");
      }
      const exposure = toolExposure(name, ns);
      if (!exposure) {
        return rpcError(id, -32601, `Tool not found: ${name}`);
      }
      if (!tierAllows(tier, exposure)) {
        return rpcError(id, -32001, deniedMessage(name, exposure), {
          required_tier: exposure,
          caller_tier: tier,
        });
      }
      const result: ToolResult = await ns!.handleHttpToolCall(
        name,
        withAgentId(c, msg.params?.arguments ?? {}),
        callerCtx(c, tier),
      );
      if (result.isError) {
        return rpcError(id, -32601, result.content[0]?.text ?? "Tool error");
      }
      return { jsonrpc: "2.0", id, result };
    }

    if (method && id === undefined) return null;
    return rpcError(id, -32601, `Method not found: ${method}`);
  }

  // SSE transport: GET /mcp/:namespace with Accept: text/event-stream
  // SLICE-259-19: same structured 406 contract as /mcp — before this,
  // namespace GETs returned a bare string error with no next-step hint.
  routes.get("/", (c) => {
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

  // SLICE-259-19: explicit 405 — mirrors /mcp (SLICE-234-29); without it
  // DELETE/PUT/PATCH fall into the JSON-RPC catch-all below.
  routes.on(["DELETE", "PUT", "PATCH"], "/", (c) =>
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

  // JSON-RPC: tools/list, tools/call, initialize
  routes.all("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return ns!.handleHttpRequest(c.req.raw);
    }

    const tier = resolveCallerTier(c);

    if (Array.isArray(body)) {
      const replies = await Promise.all(
        (body as RpcMessage[]).map((msg) => dispatchRpc(msg, tier, c)),
      );
      return c.json(replies.filter((r): r is Record<string, unknown> => r !== null));
    }

    const msg = body as RpcMessage;
    const method = msg.method;
    const id = msg.id;

    if (method === "tools/list" || method === "tools/call") {
      const reply = await dispatchRpc(msg, tier, c);
      return c.json(reply);
    }

    if (method && method !== "initialize") {
      if (id === undefined) return c.body(null, 202);
      return c.json(rpcError(id, -32601, `Method not found: ${method}`));
    }

    // For initialize and non-JSON-RPC requests, delegate to SDK transport.
    const rawBody = JSON.stringify(body);
    const newRequest = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: rawBody,
    });
    return ns!.handleHttpRequest(newRequest);
  });

  // REST: list tools
  routes.get("/tools", (c) => {
    const tier = resolveCallerTier(c);
    return c.json({ tools: filterToolsByTier(ns!.listTools(), tier) });
  });

  // REST: call tool by name
  routes.post("/tools/:toolName", async (c) => {
    const toolName = c.req.param("toolName");
    const tier = resolveCallerTier(c);

    const exposure = toolExposure(toolName, ns);
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
      const rawBody = await c.req.text();
      args = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      const result = {
        isError: true,
        content: [{ type: "text" as const, text: "Malformed JSON body" }],
      };
      return c.json(result);
    }

    const result = await ns!.handleHttpToolCall(
      toolName,
      withAgentId(c, args),
      callerCtx(c, tier),
    );
    return c.json(result);
  });

  return routes;
}

/**
 * Inject the caller's agentId (set by bearer-auth middleware) into tool
 * args as `_agentId` — lets per-agent tools (e.g. telegram subscriptions,
 * SLICE-141-10) identify the caller without changing ToolHandler's
 * signature in @agentbadge/mcp.
 */
function withAgentId(
  c: Context,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const agentId = c.get("agentId") as string | undefined;
  return agentId ? { ...args, _agentId: agentId } : args;
}
