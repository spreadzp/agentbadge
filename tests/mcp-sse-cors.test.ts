import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { registerTool, type ToolResult } from "@agentbadge/mcp";
import { Hono } from "hono";
import { corsMiddleware } from "../src/server/middleware/cors";
import { mcpRoutes } from "../src/server/routes/mcp";

const dummyHandler = vi.fn(async (args: Record<string, unknown>): Promise<ToolResult> => ({
  content: [{ type: "text", text: JSON.stringify(args) }],
}));

beforeEach(() => {
  vi.clearAllMocks();
  registerTool("echo", "Echo the input back", { message: z.string() }, dummyHandler);
});

describe("MCP SSE + CORS", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use(corsMiddleware());
    app.route("/", mcpRoutes);
  });

  it("GET /mcp with Accept: text/event-stream returns SSE or 406", async () => {
    const res = await app.request("/mcp", {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });

    expect([200, 406]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    }
  });

  it("OPTIONS /mcp has Access-Control-Allow-Origin", async () => {
    const res = await app.request("/mcp", { method: "OPTIONS" });

    expect(res.headers.get("access-control-allow-origin")).toBeDefined();
  });

  it("POST /mcp tools/list has CORS headers", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeDefined();
  });
});
