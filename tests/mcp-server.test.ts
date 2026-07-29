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
  startStdio,
  mcpServer,
  type ToolResult,
} from "@agentgate-hedera/mcp";
import { Hono } from "hono";
import { mcpRoutes } from "../src/server/routes/mcp";

const dummyHandler = vi.fn(async (args: Record<string, unknown>): Promise<ToolResult> => ({
  content: [{ type: "text", text: JSON.stringify(args) }],
}));

beforeEach(() => {
  vi.clearAllMocks();
  registerTool("echo", "Echo the input back", { message: z.string() }, dummyHandler);
});

describe("MCP Server — registry", () => {
  it("registers a tool and exposes it via listTools", () => {
    const tools = listTools();
    expect(tools).toContainEqual({ name: "echo", description: "Echo the input back" });
  });

  it("mcpServer instance has name 'agent-passport'", () => {
    expect(mcpServer).toBeDefined();
  });
});

describe("MCP Server — handleHttpToolCall", () => {
  it("dispatches to the registered tool handler with parsed args", async () => {
    const result = await handleHttpToolCall("echo", { message: "hello" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.message).toBe("hello");
  });

  it("returns MCP-shaped error for unknown tool name", async () => {
    const result = await handleHttpToolCall("nonexistent", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nonexistent");
  });

  it("returns MCP-shaped error when args fail schema validation", async () => {
    const result = await handleHttpToolCall("echo", { wrong_field: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("message");
  });

  it("returns MCP-shaped error when handler throws", async () => {
    registerTool("boom", "Always throws", { x: z.number() }, async () => {
      throw new Error("kaboom");
    });
    const result = await handleHttpToolCall("boom", { x: 1 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("kaboom");
  });
});

describe("MCP Server — HTTP route", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", mcpRoutes);
  });

  it("POST /mcp/tools/:toolName dispatches to handleHttpToolCall", async () => {
    const res = await app.request("/mcp/tools/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "via-http" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isError).toBeUndefined();
    const parsed = JSON.parse(body.content[0].text);
    expect(parsed.message).toBe("via-http");
  });

  it("POST /mcp/tools/:toolName for unknown tool returns error, not 500", async () => {
    const res = await app.request("/mcp/tools/ghost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isError).toBe(true);
    expect(body.content[0].text).toContain("ghost");
  });

  it("POST /mcp/tools/:toolName with malformed JSON returns MCP error", async () => {
    const res = await app.request("/mcp/tools/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isError).toBe(true);
  });

  it("GET /mcp/tools returns list of registered tools", async () => {
    const res = await app.request("/mcp/tools", { method: "GET" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toBeDefined();
    expect(body.tools.some((t: { name: string }) => t.name === "echo")).toBe(true);
  });
});

describe("MCP Server — startStdio", () => {
  it("calls mcpServer.connect with a StdioServerTransport", async () => {
    const connectSpy = vi.spyOn(mcpServer, "connect");
    await startStdio();
    expect(connectSpy).toHaveBeenCalledOnce();
  });
});
