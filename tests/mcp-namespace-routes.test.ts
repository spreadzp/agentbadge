import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { Hono } from "hono";
import { createNamespace, registerTool } from "@agentbadge/mcp";
import { createNamespaceRoutes } from "../src/server/routes/mcp-namespace";

describe("Namespace HTTP routes — tools/list", () => {
  let app: Hono;

  beforeEach(() => {
    const ns = createNamespace("test-ns-routes");
    ns.registerTool("ns_specific_tool", "A namespace tool", { x: z.string() }, async () => ({
      content: [{ type: "text", text: "ns-result" }],
    }));

    app = new Hono();
    app.route("/mcp/test-ns-routes", createNamespaceRoutes("test-ns-routes"));
  });

  it("POST /mcp/:namespace with tools/list returns only namespace tools", async () => {
    const res = await app.request("/mcp/test-ns-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result.tools).toBeDefined();
    expect(body.result.tools.some((t: { name: string }) => t.name === "ns_specific_tool")).toBe(true);
  });

  it("POST /mcp/:namespace with tools/call executes namespace tool", async () => {
    const res = await app.request("/mcp/test-ns-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "ns_specific_tool", arguments: { x: "hello" } },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result.content[0].text).toBe("ns-result");
  });

  it("POST /mcp/:namespace/tools/:toolName calls namespace tool via REST", async () => {
    const res = await app.request("/mcp/test-ns-routes/tools/ns_specific_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: "via-rest" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content[0].text).toBe("ns-result");
  });

  it("GET /mcp/:namespace/tools returns namespace tool list", async () => {
    const res = await app.request("/mcp/test-ns-routes/tools", { method: "GET" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toBeDefined();
    expect(body.tools.some((t: { name: string }) => t.name === "ns_specific_tool")).toBe(true);
  });

  it("GET /mcp/:namespace with Accept: text/event-stream returns SSE", async () => {
    const res = await app.request("/mcp/test-ns-routes", {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("POST /mcp/:namespace with unknown method returns -32601 error", async () => {
    const res = await app.request("/mcp/test-ns-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "unknown/method" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("POST /mcp/:namespace/tools/:toolName for unknown tool returns error", async () => {
    const res = await app.request("/mcp/test-ns-routes/tools/nonexistent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isError).toBe(true);
    expect(body.content[0].text).toContain("nonexistent");
  });
});

describe("Namespace HTTP routes — nonexistent namespace", () => {
  it("returns 503 for unregistered namespace", async () => {
    const app = new Hono();
    app.route("/mcp/ghost", createNamespaceRoutes("ghost-namespace"));

    const res = await app.request("/mcp/ghost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(res.status).toBe(503);
  });
});

describe("Namespace HTTP routes — isolation from default namespace", () => {
  it("namespace route does not return default namespace tools", async () => {
    registerTool("default_only_ns_test", "Default only", {}, async () => ({
      content: [{ type: "text", text: "default" }],
    }));

    const ns = createNamespace("iso-routes");
    ns.registerTool("ns_only_tool", "NS only", {}, async () => ({
      content: [{ type: "text", text: "ns" }],
    }));

    const app = new Hono();
    app.route("/mcp/iso-routes", createNamespaceRoutes("iso-routes"));

    const res = await app.request("/mcp/iso-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    const body = await res.json();
    expect(body.result.tools.some((t: { name: string }) => t.name === "ns_only_tool")).toBe(true);
    expect(body.result.tools.some((t: { name: string }) => t.name === "default_only_ns_test")).toBe(false);
  });
});
