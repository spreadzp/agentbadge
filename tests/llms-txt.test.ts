import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { getLlmsTxt, MCP_TOOLS_INDEX } from "@agentgate-hedera/hedera-core";
import {
  listTools,
  registerPassportTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerGuideTools,
  registerSigningTools,
  registerDiscoveryTools,
} from "@agentgate-hedera/mcp";
import { catalogRoutes } from "../src/server/routes/catalog";

describe("SLICE-18-8: llms.txt upgrade", () => {
  describe("Unit: getLlmsTxt()", () => {
    const txt = getLlmsTxt();

    it("contains MCP Tools section header with count", () => {
      expect(txt).toContain("### MCP Tools");
      expect(txt).toContain(`${MCP_TOOLS_INDEX.length} total`);
    });

    it("lists all 32 MCP tools in a table", () => {
      for (const tool of MCP_TOOLS_INDEX) {
        expect(txt).toContain(tool.name);
        expect(txt).toContain(tool.category);
      }
    });

    it("MCP_TOOLS_INDEX count matches registered MCP tools", () => {
      registerPassportTools();
      registerAuditCatalogTools();
      registerDirectoryTools();
      registerA2ATools();
      registerMarketplaceTools();
      registerGuideTools();
      registerSigningTools();
      registerDiscoveryTools();
      const registered = listTools();
      expect(MCP_TOOLS_INDEX.length).toBe(registered.length);
      for (const r of registered) {
        expect(MCP_TOOLS_INDEX.find((t) => t.name === r.name)).toBeDefined();
      }
    });

    it("contains Curl Examples section with >= 5 commands", () => {
      expect(txt).toContain("### Curl Examples");
      const curlCount = (txt.match(/^curl /gm) || []).length;
      expect(curlCount).toBeGreaterThanOrEqual(5);
    });

    it("curl examples reference real endpoints (not 404s)", () => {
      expect(txt).toContain("/passport/");
      expect(txt).toContain("/agents");
      expect(txt).toContain("/.well-known/agent-card.json");
      expect(txt).toContain("/catalog");
      expect(txt).toContain("/a2a/send");
      expect(txt).toContain("/market/tasks");
    });

    it("contains Content Pages section with /faq and /use-cases", () => {
      expect(txt).toContain("### Content Pages");
      expect(txt).toContain("/faq");
      expect(txt).toContain("/use-cases");
    });

    it("preserves pre-existing sections (regression)", () => {
      expect(txt).toContain("# Agent Passport on Hedera");
      expect(txt).toContain("## Base URL");
      expect(txt).toContain("## Authentication");
      expect(txt).toContain("## Machine-readable Entry Points");
      expect(txt).toContain("## Quick Start");
      expect(txt).toContain("## Endpoints");
      expect(txt).toContain("## Guides");
      expect(txt).toContain("## MCP Server");
      expect(txt).toContain("## Error Format");
      expect(txt).toContain("## Payment");
    });

    it("stays under 50KB (LLM context-friendly)", () => {
      expect(txt.length).toBeLessThan(50 * 1024);
    });
  });

  describe("Integration: GET /llms.txt", () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.route("/", catalogRoutes);
    });

    it("returns 200 with text/plain content type", async () => {
      const res = await app.request("/llms.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
    });

    it("response body contains new sections", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("### MCP Tools");
      expect(text).toContain("### Curl Examples");
      expect(text).toContain("### Content Pages");
    });

    it("response body contains tool table with categories", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      expect(text).toContain("| Tool | Category | Description |");
      expect(text).toContain("| passport |");
      expect(text).toContain("| directory |");
      expect(text).toContain("| market |");
    });
  });
});
