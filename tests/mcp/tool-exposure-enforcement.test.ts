import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { registerTool, type ToolResult } from "@agentbadge/mcp";
import { Hono, type Context, type Next } from "hono";
import { mcpRoutes } from "../../src/server/routes/mcp/mcp";

const spy = vi.fn(async (): Promise<ToolResult> => ({
  content: [{ type: "text", text: "executed" }],
}));

const ADMIN_TOOL = "exp_enf_admin_tool";
const AUTH_TOOL = "exp_enf_auth_tool";
const PUBLIC_TOOL = "exp_enf_public_tool";
const ADMIN_KEY = "test-admin-key";

registerTool(PUBLIC_TOOL, "public", {}, spy, {
    exposure: "public",
    publicTier: "curated",
  });
registerTool(AUTH_TOOL, "auth", {}, spy, { exposure: "authenticated" });
registerTool(ADMIN_TOOL, "admin", {}, spy, { exposure: "admin" });

const rpc = (method: string, params?: unknown, id = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params });

function makeApp(setAgent?: (c: Context) => void): Hono {
  const app = new Hono();
  if (setAgent) {
    app.use("*", async (c: Context, next: Next) => {
      setAgent(c);
      await next();
    });
  }
  app.route("/", mcpRoutes);
  return app;
}

const anonApp = makeApp();
const agentApp = makeApp((c) => c.set("agentId", "agent-1"));


describe("tool exposure enforcement — anonymous (SLICE-259-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    // 264-9: shared key reaches admin tier via break-glass flag.
    process.env.ADMIN_BREAK_GLASS_ENABLED = "true";
  });

  it("denies tools/call on admin tool via JSON-RPC", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/call", { name: ADMIN_TOOL, arguments: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("denies tools/call on admin tool via REST alias", async () => {
    const res = await anonApp.request(`/mcp/tools/${ADMIN_TOOL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("denies admin tool inside a JSON-RPC batch (no SDK bypass)", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: ADMIN_TOOL, arguments: {} } },
      ]),
    });
    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : data;
    expect(item.error).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("denies authenticated tool for anonymous caller", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/call", { name: AUTH_TOOL, arguments: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows public tool for anonymous caller", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/call", { name: PUBLIC_TOOL, arguments: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("denies unknown tool name", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/call", { name: "no_such_tool_xyz", arguments: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("tools/list hides authenticated+admin tools from anonymous", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/list"),
    });
    const data = await res.json();
    const names = data.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain(PUBLIC_TOOL);
    expect(names).not.toContain(AUTH_TOOL);
    expect(names).not.toContain(ADMIN_TOOL);
  });

  it("GET /mcp/tools hides non-public tools from anonymous", async () => {
    const res = await anonApp.request("/mcp/tools");
    const data = await res.json();
    const names = data.tools.map((t: { name: string }) => t.name);
    expect(names).toContain(PUBLIC_TOOL);
    expect(names).not.toContain(ADMIN_TOOL);
  });
});

describe("tool exposure enforcement — authenticated caller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    // 264-9: shared key reaches admin tier via break-glass flag.
    process.env.ADMIN_BREAK_GLASS_ENABLED = "true";
  });

  it("allows authenticated tool for keyed agent", async () => {
    const res = await agentApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/call", { name: AUTH_TOOL, arguments: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("still denies admin tool for keyed agent", async () => {
    const res = await agentApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/call", { name: ADMIN_TOOL, arguments: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("tools/list shows public+authenticated for keyed agent", async () => {
    const res = await agentApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/list"),
    });
    const data = await res.json();
    const names = data.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain(PUBLIC_TOOL);
    expect(names).toContain(AUTH_TOOL);
    expect(names).not.toContain(ADMIN_TOOL);
  });
});

describe("tool exposure enforcement — admin caller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    // 264-9: shared key reaches admin tier via break-glass flag.
    process.env.ADMIN_BREAK_GLASS_ENABLED = "true";
  });

  it("admin key can call admin tools", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: rpc("tools/call", { name: ADMIN_TOOL, arguments: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });
});
