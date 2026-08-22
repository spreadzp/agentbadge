import { describe, it, expect, vi, beforeAll } from "vitest";
import { z } from "zod";
import { Hono } from "hono";
import { createNamespaceRoutes } from "../src/server/routes/mcp-namespace";
import {
  createNamespace,
  getNamespace,
  registerPassportTools,
  registerSigningTools,
  registerEscrowTools,
  registerMarketplaceTools,
  registerDatasetTools,
  registerDiscoveryTools,
  registerDirectoryTools,
  registerGuideTools,
  registerA2ATools,
  registerAuditCatalogTools,
  registerAllTools,
  registerTool,
  type ToolResult,
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../src/mcp/compliance-tools";
import { registerParityTools } from "../src/mcp/parity-tools";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

beforeAll(() => {
  const passportNs = createNamespace("passport");
  registerPassportTools(passportNs);
  registerSigningTools(passportNs);
  registerEscrowTools(passportNs);

  const marketNs = createNamespace("market");
  registerMarketplaceTools(marketNs);
  registerDatasetTools(marketNs);

  const discoveryNs = createNamespace("discovery");
  registerDiscoveryTools(discoveryNs);
  registerDirectoryTools(discoveryNs);
  registerGuideTools(discoveryNs);
  registerA2ATools(discoveryNs);

  const auditNs = createNamespace("audit");
  registerAuditCatalogTools(auditNs);
  registerComplianceTools(auditNs);
  registerParityTools(auditNs);

  const allNs = createNamespace("all");
  registerAllTools(allNs);
  registerComplianceTools(allNs);
  registerParityTools(allNs);
});

function makeApp(nsName: string): Hono {
  const app = new Hono();
  app.route("/", createNamespaceRoutes(nsName));
  return app;
}

describe("SLICE-72-10: JSON-RPC namespace endpoints", () => {
  describe("POST /mcp/passport", () => {
    it("tools/list returns only passport tools (16)", async () => {
      const app = makeApp("passport");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools).toBeInstanceOf(Array);
      expect(data.result.tools.length).toBe(16);
    });

    it("tools/call rejects non-passport tool", async () => {
      const app = makeApp("passport");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "list_marketplace_tasks", arguments: {} },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("POST /mcp/market", () => {
    it("tools/list returns only market tools (8)", async () => {
      const app = makeApp("market");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(8);
    });
  });

  describe("POST /mcp/discovery", () => {
    it("tools/list returns only discovery tools (12)", async () => {
      const app = makeApp("discovery");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(12);
    });
  });

  describe("POST /mcp/audit", () => {
    it("tools/list returns only audit tools (29)", async () => {
      const app = makeApp("audit");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(29);
    });
  });

  describe("POST /mcp/all (aggregator)", () => {
    it("tools/list returns all 65 tools", async () => {
      const app = makeApp("all");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(65);
    });
  });

  describe("REST endpoints", () => {
    it("GET /tools returns tool list for passport namespace", async () => {
      const app = makeApp("passport");
      const res = await app.request("/tools", { method: "GET" });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools).toBeInstanceOf(Array);
      expect(data.tools.length).toBe(16);
    });

    it("GET / returns 406 without Accept: text/event-stream", async () => {
      const app = makeApp("passport");
      const res = await app.request("/", { method: "GET" });
      expect(res.status).toBe(406);
    });

    it("GET / returns SSE with Accept: text/event-stream", async () => {
      const app = makeApp("passport");
      const res = await app.request("/", {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    });
  });

  describe("Cross-namespace isolation", () => {
    it("passport tools/list does not contain market tools", async () => {
      const app = makeApp("passport");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      });
      const data = await res.json();
      const toolNames = data.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).not.toContain("list_marketplace_tasks");
      expect(toolNames).not.toContain("search_directory");
    });

    it("audit tools/list does not contain passport tools", async () => {
      const app = makeApp("audit");
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list" }),
      });
      const data = await res.json();
      const toolNames = data.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).not.toContain("mint_passport");
      expect(toolNames).not.toContain("sign_message");
    });
  });
});
