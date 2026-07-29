import { Hono } from "hono";
import { handleHttpToolCall, listTools, handleHttpRequest } from "@agentgate-hedera/mcp";

export const mcpRoutes = new Hono();

mcpRoutes.all("/mcp", (c) => {
  return handleHttpRequest(c.req.raw);
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
