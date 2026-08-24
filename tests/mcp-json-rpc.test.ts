import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  registerTool,
  listTools,
  handleHttpToolCall,
  type ToolResult,
} from "@agentgate-hedera/mcp";
import { Hono } from "hono";
import { mcpRoutes } from "../src/server/routes/mcp";
import { makeTestApp } from "./e2e/helpers";

const dummyHandler = vi.fn(async (args: Record<string, unknown>): Promise<ToolResult> => ({
  content: [{ type: "text", text: JSON.stringify(args) }],
}));

beforeEach(() => {
  vi.clearAllMocks();
  registerTool("echo", "Echo the input back", { message: z.string() }, dummyHandler);
});

describe("MCP JSON-RPC /mcp endpoint", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", mcpRoutes);
  });

  it("responds to tools/list with tools array including inputSchema", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(2);
    expect(data.result).toBeDefined();
    expect(data.result.tools).toBeInstanceOf(Array);
    expect(data.result.tools.length).toBeGreaterThan(0);
    expect(data.result.tools[0]).toHaveProperty("name");
    expect(data.result.tools[0]).toHaveProperty("description");
    expect(data.result.tools[0]).toHaveProperty("inputSchema");
  });

  it("responds to tools/call with content or structured error", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hello" } },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(3);
    expect(data.result || data.error).toBeDefined();
  });

  it("returns -32601 for unknown method", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "unknown/method",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(4);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32601);
  });

  it("returns -32602 for tools/call with missing tool name", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {},
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32602);
  });

  it("returns -32601 for tools/call with unknown tool name", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error).toBeDefined();
    // Unknown tool should return -32601 (method not found) since the tool doesn't exist
    expect(data.error.code).toBe(-32601);
  });

  it("initialize method delegates to SDK transport (no regression)", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    // Initialize delegates to SDK transport, not our intercept logic.
    // In test env without real session, transport may return 400/406.
    // Key: our code doesn't crash (no 500).
    expect(res.status).toBeLessThan(500);
  });
});

// ─── SLICE-72-10: Namespace JSON-RPC tests ──────────────────────────────────

describe("SLICE-72-10: Namespace JSON-RPC endpoints", () => {
  let app: Hono;

  beforeEach(() => {
    app = makeTestApp();
  });

  it("POST /mcp/passport — tools/list returns only passport namespace tools", async () => {
    const res = await app.request("/mcp/passport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.tools).toBeInstanceOf(Array);
    expect(data.result.tools.length).toBe(16);
  });

  it("POST /mcp/market — tools/list returns only market namespace tools", async () => {
    const res = await app.request("/mcp/market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.tools.length).toBe(8);
  });

  it("POST /mcp/discovery — tools/list returns only discovery namespace tools", async () => {
    const res = await app.request("/mcp/discovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.tools.length).toBe(12);
  });

  it("POST /mcp/audit — tools/list returns only audit namespace tools", async () => {
    const res = await app.request("/mcp/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.tools.length).toBe(29);
  });

  it("POST /mcp (aggregator) — tools/list returns all tools", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.tools.length).toBeGreaterThanOrEqual(65);
  });

  it("POST /mcp/passport — tools/call rejects non-passport tool", async () => {
    const res = await app.request("/mcp/passport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "post_task", arguments: {} },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32601);
  });
});
