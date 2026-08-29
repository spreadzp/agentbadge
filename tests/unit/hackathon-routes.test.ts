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

    it("does not include /hackathon/datahub yet (SLICE-91-2)", () => {
      expect(PageMeta["/hackathon/datahub"]).toBeUndefined();
    });
  });

  describe("Route isolation", () => {
    it("does not conflict with existing /datahub route", async () => {
      // /datahub should still be served by landingRoutes, not hackathonRoutes
      // This test just verifies hackathonRoutes doesn't handle /datahub
      const res = await app.request("/datahub");
      expect(res.status).toBe(404); // hackathonRoutes doesn't have /datahub
    });
  });
});
