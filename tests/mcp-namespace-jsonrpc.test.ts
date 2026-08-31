import { describe, it, expect, vi, beforeAll } from "vitest";
import { Hono } from "hono";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  createNamespace,
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
} from "@agentbadge/mcp";
import { registerComplianceTools } from "../src/mcp/compliance-tools";
import { registerParityTools } from "../src/mcp/parity-tools";
import { createNamespaceRoutes } from "../src/server/routes/mcp-namespace";

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

function makeApp(): Hono {
  const app = new Hono();
  app.route("/mcp/passport", createNamespaceRoutes("passport"));
  app.route("/mcp/market", createNamespaceRoutes("market"));
  app.route("/mcp/discovery", createNamespaceRoutes("discovery"));
  app.route("/mcp/audit", createNamespaceRoutes("audit"));
  app.route("/mcp", createNamespaceRoutes("all"));
  return app;
}

describe("SLICE-72-10: JSON-RPC namespace endpoints", () => {
  describe("POST /mcp/passport", () => {
    it("tools/list returns only 16 passport tools", async () => {
      const app = makeApp();
      const res = await app.request("/mcp/passport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(16);
    });

    it("tools/call rejects non-passport tool", async () => {
      const app = makeApp();
      const res = await app.request("/mcp/passport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "post_task", arguments: {} },
        }),
      });
      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("POST /mcp/market", () => {
    it("tools/list returns only 8 market tools", async () => {
      const app = makeApp();
      const res = await app.request("/mcp/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(8);
    });
  });

  describe("POST /mcp/discovery", () => {
    it("tools/list returns only 12 discovery tools", async () => {
      const app = makeApp();
      const res = await app.request("/mcp/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(12);
    });
  });

  describe("POST /mcp/audit", () => {
    it("tools/list returns only 29 audit tools", async () => {
      const app = makeApp();
      const res = await app.request("/mcp/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(29);
    });
  });

  describe("POST /mcp (aggregator)", () => {
    it("tools/list returns all 65 tools", async () => {
      const app = makeApp();
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result.tools.length).toBe(65);
    });
  });

  describe("REST endpoints", () => {
    it("GET /mcp/passport/tools returns 16 tools", async () => {
      const app = makeApp();
      const res = await app.request("/mcp/passport/tools");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools.length).toBe(16);
    });

    it("GET /mcp/audit/tools returns 29 tools", async () => {
      const app = makeApp();
      const res = await app.request("/mcp/audit/tools");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools.length).toBe(29);
    });
  });
});
