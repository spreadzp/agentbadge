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
import { createNamespace } from "@agentbadge/mcp";
import { registerParityTools } from "../../src/mcp/parity-tools";
import { registerBoardTools } from "../../src/mcp/board-tools";
import { registerAttestcoinTools } from "../../src/mcp/attestcoin-tools";
import { registerKnowledgeTools } from "../../src/mcp/knowledge-tools";
import { registerComplianceTools } from "../../src/mcp/compliance-tools";
import { collectMcpServer } from "../../src/server/lib/agent-discovery/mcp-source";

// SLICE-259-7: anonymous tools/list = curated subset (≤20), full
// public+authenticated list behind agb_. Extended-public tools stay
// callable anonymously — curation is a discovery projection, not an
// auth boundary (exposure still governs execution).

const spy = vi.fn(async (): Promise<ToolResult> => ({
  content: [{ type: "text", text: "executed" }],
}));

const CURATED = "cur_anon_tool";
const EXTENDED = "cur_ext_tool";
const ADMIN_KEY = "test-admin-key";

registerTool(CURATED, "curated public", {}, spy, {
  exposure: "public",
  publicTier: "curated",
});
registerTool(EXTENDED, "extended public", {}, spy, { exposure: "public" });

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


describe("curated anonymous tools/list — SLICE-259-7", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  it("anonymous REST list shows curated tools only", async () => {
    const res = await anonApp.request("/mcp/tools", { method: "GET" });
    const data = (await res.json()) as { tools: { name: string }[] };
    const names = data.tools.map((t) => t.name);
    expect(names).toContain(CURATED);
    expect(names).not.toContain(EXTENDED);
  });

  it("anonymous JSON-RPC tools/list shows curated tools only", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("tools/list"),
    });
    const data = (await res.json()) as {
      result: { tools: { name: string }[] };
    };
    const names = data.result.tools.map((t) => t.name);
    expect(names).toContain(CURATED);
    expect(names).not.toContain(EXTENDED);
  });

  it("authenticated caller sees the extended public set too", async () => {
    const res = await agentApp.request("/mcp/tools", { method: "GET" });
    const data = (await res.json()) as { tools: { name: string }[] };
    const names = data.tools.map((t) => t.name);
    expect(names).toContain(CURATED);
    expect(names).toContain(EXTENDED);
  });

  it("extended-public tool stays callable anonymously (list-only curation)", async () => {
    const res = await anonApp.request(`/mcp/tools/${EXTENDED}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
  });
});

describe("curated set size — real server registry", () => {
  it("anon projection across server registrars stays ≤ 20", () => {
    const ns = createNamespace("cur-srv");
    registerParityTools(ns);
    registerBoardTools(ns);
    registerAttestcoinTools(ns);
    registerKnowledgeTools(ns);
    registerComplianceTools(ns);
    const serverCurated = ns
      .listTools()
      .filter((t) => t.publicTier === "curated");
    // Server-side curated: search_knowledge, get_knowledge_object,
    // board_list, board_get, check_compliance (5).
    expect(serverCurated.map((t) => t.name).sort()).toEqual([
      "board_get",
      "board_list",
      "check_compliance",
      "get_knowledge_object",
      "search_knowledge",
    ]);
    // Package curated set is ≤15 — combined stays ≤20.
    expect(serverCurated.length).toBeLessThanOrEqual(5);
  });
});

describe("public catalog projection (llms.txt / agent-card)", () => {
  // collectMcpServer reads the global registry — register the probes
  // globally with unique names.
  registerTool("cat_curated_x", "c", {}, spy, {
    exposure: "public",
    publicTier: "curated",
  });
  registerTool("cat_extended_x", "e", {}, spy, { exposure: "public" });
  registerTool("cat_auth_x", "a", {}, spy, { exposure: "authenticated" });

  it("catalog exposes only the curated anon set", () => {
    const listed = (collectMcpServer()?.tools ?? []).map((t) => t.name);
    expect(listed).toContain("cat_curated_x");
    expect(listed).not.toContain("cat_extended_x");
    expect(listed).not.toContain("cat_auth_x");
  });
});
