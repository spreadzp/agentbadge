import { Hono } from "hono";
import { getNamespace, type ToolResult } from "@agentbadge/mcp";

export function createNamespaceRoutes(namespaceName: string): Hono {
  const routes = new Hono();
  const ns = getNamespace(namespaceName);

  if (!ns) {
    routes.all("/*", (c) =>
      c.json({ error: `Namespace '${namespaceName}' not found` }, 503),
    );
    return routes;
  }

  // SSE transport: GET /mcp/:namespace with Accept: text/event-stream
  routes.get("/", (c) => {
    const accept = c.req.header("Accept") ?? "";
    if (!accept.includes("text/event-stream")) {
      return c.json({ error: "Not Acceptable: Client must accept text/event-stream" }, 406);
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

  // JSON-RPC: tools/list, tools/call, initialize
  routes.all("/", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return ns.handleHttpRequest(c.req.raw);
    }

    const method = body.method as string | undefined;
    const id = body.id;

    if (method === "tools/list") {
      const tools = ns.listTools();
      return c.json({
        jsonrpc: "2.0",
        id,
        result: { tools },
      });
    }

    if (method === "tools/call") {
      const params = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!params.name) {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing required parameter: name" },
        });
      }
      const result: ToolResult = await ns.handleHttpToolCall(params.name, params.arguments ?? {});
      if (result.isError) {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: result.content[0]?.text ?? "Tool error" },
        });
      }
      return c.json({
        jsonrpc: "2.0",
        id,
        result,
      });
    }

    if (method && method !== "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }

    // For initialize and non-JSON-RPC requests, delegate to SDK transport.
    const rawBody = JSON.stringify(body);
    const newRequest = new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: rawBody,
    });
    return ns.handleHttpRequest(newRequest);
  });

  // REST: list tools
  routes.get("/tools", (c) => {
    return c.json({ tools: ns.listTools() });
  });

  // REST: call tool by name
  routes.post("/tools/:toolName", async (c) => {
    const toolName = c.req.param("toolName");

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

    const result = await ns.handleHttpToolCall(toolName, args);
    return c.json(result);
  });

  return routes;
}
