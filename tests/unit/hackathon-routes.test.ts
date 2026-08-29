import { describe, it, expect, vi } from "vitest";

// Mock env config to avoid loadConfig requiring real env vars
vi.mock("../../src/config/env.js", () => ({
  getConfig: vi.fn(() => ({
    chainMode: "hedera",
    hederaNetwork: "testnet",
    ui: {
      currencySymbol: "ℏ",
      chainName: "Hedera Testnet",
      nftStandard: "HIP-412",
      consensus: "HCS",
      explorerTxUrl: "https://hashscan.io/testnet/transaction/",
      explorerAccountUrl: "https://hashscan.io/testnet/account/",
    },
  })),
  loadConfig: vi.fn(() => ({})),
  resetConfigCache: vi.fn(),
}));

import { Hono } from "hono";
import { hackathonRoutes } from "../../src/server/routes/hackathon";
import { landingRoutes } from "../../src/server/routes/landing";
import { PageMeta } from "../../src/server/lib/page-meta";

describe("SLICE-91-1: Hackathon Routing Structure", () => {
  const app = new Hono();
  app.route("/", hackathonRoutes);

  describe("GET /hackathon/:name", () => {
    it("returns 200 for known hackathon name 'webmcp'", async () => {
      const res = await app.request("/hackathon/webmcp");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<!DOCTYPE html>");
    });

    it("returns 404 for unknown hackathon name", async () => {
      const res = await app.request("/hackathon/nonexistent");
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toContain("Hackathon not found");
    });

    it("returns 404 for empty hackathon name", async () => {
      const res = await app.request("/hackathon/");
      expect(res.status).toBe(404);
    });

    it("rejects invalid characters in name parameter", async () => {
      const res = await app.request("/hackathon/evil%3Cscript%3E");
      expect(res.status).toBe(404);
    });

    it("renders page within LandingLayout", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("AgentBadge");
    });
  });

  describe("PageMeta registry", () => {
    it("includes /hackathon/webmcp entry", () => {
      expect(PageMeta["/hackathon/webmcp"]).toBeDefined();
      expect(PageMeta["/hackathon/webmcp"].title).toBeTruthy();
      expect(PageMeta["/hackathon/webmcp"].description).toBeTruthy();
      expect(PageMeta["/hackathon/webmcp"].path).toBe("/hackathon/webmcp");
    });
  });
});

describe("SLICE-91-2: Move DataHub to /hackathon/datahub", () => {
  const hackathonApp = new Hono();
  hackathonApp.route("/", hackathonRoutes);

  const landingApp = new Hono();
  landingApp.route("/", landingRoutes);

  describe("GET /hackathon/datahub", () => {
    it("returns 200 with DataHub content", async () => {
      const res = await hackathonApp.request("/hackathon/datahub");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<!DOCTYPE html>");
    });
  });

  describe("GET /datahub (redirect)", () => {
    it("returns 301 redirect to /hackathon/datahub", async () => {
      const res = await landingApp.request("/datahub");
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/hackathon/datahub");
    });

    it("preserves query parameters in redirect", async () => {
      const res = await landingApp.request("/datahub?foo=bar");
      expect(res.status).toBe(301);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/hackathon/datahub");
      expect(location).toContain("foo=bar");
    });
  });

  describe("PageMeta registry", () => {
    it("includes /hackathon/datahub entry", () => {
      expect(PageMeta["/hackathon/datahub"]).toBeDefined();
      expect(PageMeta["/hackathon/datahub"].title).toBeTruthy();
      expect(PageMeta["/hackathon/datahub"].description).toBeTruthy();
      expect(PageMeta["/hackathon/datahub"].path).toBe("/hackathon/datahub");
    });

    it("removes old /datahub entry", () => {
      expect(PageMeta["/datahub"]).toBeUndefined();
    });
  });
});

describe("SLICE-91-3: WebMCP Hackathon Page Scaffold", () => {
  const app = new Hono();
  app.route("/", hackathonRoutes);

  describe("GET /hackathon/webmcp", () => {
    it("returns 200 with rendered HTML", async () => {
      const res = await app.request("/hackathon/webmcp");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<!DOCTYPE html>");
    });

    it("contains hero heading with WebMCP", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("WebMCP");
    });

    it("contains all 6 imperative tool names", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("agent-readiness-scan");
      expect(body).toContain("badge-generate");
      expect(body).toContain("passport-issue");
      expect(body).toContain("passport-verify");
      expect(body).toContain("get-compliance-score");
      expect(body).toContain("search-rules");
    });

    it("contains Chrome flag instructions", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("chrome://flags");
    });

    it("contains ChatGPT browser instructions", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("ChatGPT");
    });

    it("contains document.modelContext.registerTool calls", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("document.modelContext.registerTool");
    });

    it("contains await before registerTool calls", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("await document.modelContext.registerTool");
    });

    it("contains all 6 registerTool calls", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      const matches = body.match(/await document\.modelContext\.registerTool\(/g);
      expect(matches).toHaveLength(6);
    });

    it("contains try/catch for graceful failure", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain("try {");
      expect(body).toContain("catch");
    });

    it("contains link to well-known webmcp.json", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).toContain(".well-known/webmcp.json");
    });

    it("uses document.modelContext not navigator.modelContext", async () => {
      const res = await app.request("/hackathon/webmcp");
      const body = await res.text();
      expect(body).not.toContain("navigator.modelContext");
      expect(body).not.toContain("provideContext");
    });

    it("does NOT have WebMCP script on homepage", async () => {
      const res = await app.request("/");
      const body = await res.text();
      expect(body).not.toContain("registerTool");
    });

    it("does NOT have WebMCP script on /hackathon/datahub", async () => {
      const res = await app.request("/hackathon/datahub");
      const body = await res.text();
      expect(body).not.toContain("registerTool");
    });
  });
});
