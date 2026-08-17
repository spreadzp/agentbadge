import { Hono } from "hono";
import { handleHttpToolCall, listTools, handleHttpRequest } from "@agentgate-hedera/mcp";

export const mcpRoutes = new Hono();

// SSE transport: GET /mcp with Accept: text/event-stream
mcpRoutes.get("/mcp", (c) => {
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

mcpRoutes.all("/mcp", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return handleHttpRequest(c.req.raw);
  }

  const method = body.method as string | undefined;
  const id = body.id;

  if (method === "tools/list") {
    const tools = listTools();
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
    const result = await handleHttpToolCall(params.name, params.arguments ?? {});
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
  return c.json({ tools: listTools() });
});

mcpRoutes.post("/mcp/tools/:toolName", async (c) => {
  const toolName = c.req.param("toolName");

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

  const result = await handleHttpToolCall(toolName, args);
  return c.json(result);
});
