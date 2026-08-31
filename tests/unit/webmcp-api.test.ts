import { describe, it, expect, vi } from "vitest";

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

// Mock passport package
vi.mock("@agentbadge/passport", () => ({
  getPassportInfo: vi.fn(async (tokenId: string) => {
    if (tokenId === "0.0.999") return null;
    return {
      active: true,
      tokenId,
      serialNumber: 0,
      tier: "gold",
      capabilities: [],
      did: `did:hcs:${tokenId}:0`,
      owner: "0.0.123",
      issuedAt: 1700000000,
    };
  }),
  parseDid: vi.fn((did: string) => {
    const match = /^did:(?:hcs|hedera):(\d+\.\d+\.\d+):(\d+)$/.exec(did);
    if (!match) return null;
    return { tokenId: match[1], serial: Number(match[2]) };
  }),
}));

// Mock scanDomain to avoid real HTTP requests
vi.mock("../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn(async () => ({
    robotsTxt: { status: "ok" },
    sitemap: { status: "ok" },
  })),
}));

// Mock RuleEngine
vi.mock("../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn(() => ({
      assertions: [
        { rule_id: "AB-001", status: "VERIFIED", category: "discovery" },
        { rule_id: "AB-002", status: "MISSING", category: "discovery" },
      ],
      rulesetVersion: "1.0",
      scannedAt: new Date().toISOString(),
      totalRules: 2,
      applicableRules: 2,
    })),
  },
}));

// Mock formatScanReport
vi.mock("../../src/agent-readiness/report-formatter", () => ({
  formatScanReport: vi.fn(() => ({
    url: "https://example.com",
    score: 50,
    grade: "C",
    total_rules: 2,
    verified: 1,
    missing: 1,
    not_applicable: 0,
    skipped: 0,
    categories: [],
    top_missing: [],
    summary: "Your site scored 50/100 (C grade). 1 of 2 rules passed, 1 need attention, 0 not applicable.",
  })),
}));

// Mock assertSafeTarget to always pass in tests
vi.mock("../../src/agent-readiness/scanner/ssrf/ip-guard", () => ({
  assertSafeTarget: vi.fn(),
}));

import { Hono } from "hono";
import { webmcpApiRoutes } from "../../src/server/routes/webmcp-api";

describe("SLICE-91-9: WebMCP API Endpoints", () => {
  const app = new Hono();
  app.route("/api", webmcpApiRoutes);

  describe("GET /api/passport/verify", () => {
    it("returns 400 when no tokenId or did provided", async () => {
      const res = await app.request("/api/passport/verify");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/tokenId|did/i);
    });

    it("returns JSON content-type", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.123");
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("accepts tokenId parameter", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.123");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("valid");
      expect(body).toHaveProperty("owner");
      expect(body).toHaveProperty("tier");
      expect(body).toHaveProperty("issuedAt");
    });

    it("accepts did parameter", async () => {
      const res = await app.request("/api/passport/verify?did=did:hedera:0.0.123:0");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("valid");
    });

    it("returns 404 for non-existent tokenId", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.999");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.valid).toBe(false);
    });
  });

  describe("GET /api/score", () => {
    it("returns 400 when no url provided", async () => {
      const res = await app.request("/api/score");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/url/i);
    });

    it("returns JSON content-type", async () => {
      const res = await app.request("/api/score?url=https://example.com");
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("returns score (0-100) for a URL", async () => {
      const res = await app.request("/api/score?url=https://example.com");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("score");
      expect(body.score).toBeGreaterThanOrEqual(0);
      expect(body.score).toBeLessThanOrEqual(100);
    });

    it("returns grade (A-F) for a URL", async () => {
      const res = await app.request("/api/score?url=https://example.com");
      const body = await res.json();
      expect(body).toHaveProperty("grade");
      expect(["A", "B", "C", "D", "F"]).toContain(body.grade);
    });

    it("returns summary string", async () => {
      const res = await app.request("/api/score?url=https://example.com");
      const body = await res.json();
      expect(body).toHaveProperty("summary");
      expect(typeof body.summary).toBe("string");
    });
  });

  describe("GET /api/rules/search", () => {
    it("returns JSON content-type", async () => {
      const res = await app.request("/api/rules/search");
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("returns all rules when no query provided", async () => {
      const res = await app.request("/api/rules/search");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("rules");
      expect(Array.isArray(body.rules)).toBe(true);
      expect(body.rules.length).toBeGreaterThan(0);
    });

    it("returns rules matching query string", async () => {
      const res = await app.request("/api/rules/search?q=robots");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules.length).toBeGreaterThan(0);
      const hasRobots = body.rules.some(
        (r: { title: string; id: string }) =>
          r.title.toLowerCase().includes("robots") || r.id.toLowerCase().includes("robots"),
      );
      expect(hasRobots).toBe(true);
    });

    it("returns rules matching category filter", async () => {
      const res = await app.request("/api/rules/search?category=discovery");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules.length).toBeGreaterThan(0);
      body.rules.forEach((r: { category: string }) => {
        expect(r.category).toBe("discovery");
      });
    });

    it("returns empty array for non-matching query", async () => {
      const res = await app.request("/api/rules/search?q=zzznonexistent");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules).toHaveLength(0);
    });

    it("returns rules with id, title, category fields", async () => {
      const res = await app.request("/api/rules/search?q=robots");
      const body = await res.json();
      const rule = body.rules[0];
      expect(rule).toHaveProperty("id");
      expect(rule).toHaveProperty("title");
      expect(rule).toHaveProperty("category");
    });
  });
});
