import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { getLlmsTxt, MCP_TOOLS_INDEX } from "@agentbadge/hedera-core";
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
} from "@agentbadge/mcp";
import { catalogRoutes } from "../src/server/routes/catalog";
import { discoveryManifestRoutes } from "../src/server/routes/discovery";

describe("SLICE-18-8: llms.txt upgrade", () => {
  describe("Unit: getLlmsTxt()", () => {
    const txt = getLlmsTxt();

    it("contains MCP Tools section header with count", () => {
      expect(txt).toContain("### MCP Tools");
      expect(txt).toContain(`${MCP_TOOLS_INDEX.length} total`);
    });

    it("lists all 38 MCP tools in a table", () => {
      for (const tool of MCP_TOOLS_INDEX) {
        expect(txt).toContain(tool.name);
        expect(txt).toContain(tool.category);
      }
    });

    it("GET /llms.txt lists all registered MCP tools (registry-driven)", async () => {
      // SLICE-218-8: the served document renders the live registry —
      // the hand-maintained MCP_TOOLS_INDEX table in hedera-core is no
      // longer the source (F8). Same intent, asserted on the live route.
      registerPassportTools();
      registerAuditCatalogTools();
      registerDirectoryTools();
      registerA2ATools();
      registerMarketplaceTools();
      registerGuideTools();
      registerSigningTools();
      registerDiscoveryTools();
      const app = new Hono();
      app.route("/", catalogRoutes);
      app.route("/", discoveryManifestRoutes);
      const res = await app.request("/llms.txt");
      const text = await res.text();
      for (const t of listTools()) {
        expect(text).toContain(`\`${t.name}\``);
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
      expect(txt).toContain("## Content Pages");
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
      app.route("/", discoveryManifestRoutes);
    });

    it("returns 200 with text/plain content type", async () => {
      const res = await app.request("/llms.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
    });

    it("response body contains new sections", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      // SLICE-218-8: dynamic builder emits "## MCP Server" + "### Tools"
      // from the live registry (was "### MCP Tools" / "### Curl Examples"
      // / "## Content Pages" in the old static format).
      expect(text).toContain("## MCP Server");
      expect(text).toContain("### Tools");
    });

    it("response body contains tool list from the registry", async () => {
      const res = await app.request("/llms.txt");
      const text = await res.text();
      // Registry-driven list format: "- `tool_name` — description".
      expect(text).toContain("`request_passport`");
      expect(text).toContain("`register_agent`");
    });
  });
});
