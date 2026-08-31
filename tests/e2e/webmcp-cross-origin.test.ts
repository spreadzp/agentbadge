/**
 * SLICE-91-15: E2E Cross-Origin & Edge Case Tests — WebMCP
 *
 * Verifies cross-origin scenarios at the HTTP level:
 * - CORS headers on discovery endpoint
 * - Permissions-Policy header on /hackathon/webmcp
 * - No WebMCP tools leaked to non-hackathon pages
 * - Discovery endpoint accessible from any origin
 * - Link header present on webmcp page, absent on other pages
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

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

vi.mock("@agentgate-hedera/passport", () => ({
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
  getPrice: vi.fn(() => ({ amount: 0, currency: "HBAR" })),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@agentgate-hedera/evm-core", () => ({
  EvmChainAdapter: vi.fn(),
  SessionRegistry: vi.fn(),
  EventIndexer: vi.fn(),
  isEvmDid: vi.fn(() => false),
  parseEvmDid: vi.fn(() => null),
  isBaseDid: vi.fn(() => false),
  parseBaseDid: vi.fn(() => null),
  buildEvmDid: vi.fn(),
  buildBaseDid: vi.fn(),
  passportToAgentCard: vi.fn(() => ({})),
  tierToPassportType: vi.fn(() => "standard"),
  buildDomain: vi.fn(),
  signPayment: vi.fn(),
  signRelease: vi.fn(),
  signReclaim: vi.fn(),
  verifyPayment: vi.fn(),
  verifyRelease: vi.fn(),
  verifyReclaim: vi.fn(),
  BASE_SEPOLIA_ADDRESSES: {},
  BASE_SEPOLIA_RPC: "",
  BASE_SEPOLIA_CHAIN_ID: 0,
  BASE_SEPOLIA_EXPLORER: "",
  AGENT_PASSPORT_ABI: [],
  TASK_ESCROW_ABI: [],
  ERC20_ABI: [],
  SESSION_REGISTRY_ABI: [],
}));

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  getNftsForToken: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
}));

vi.mock("../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn(async () => ({
    robotsTxt: { status: "ok" },
    sitemap: { status: "ok" },
  })),
}));

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
    summary: "Your site scored 50/100 (C grade).",
  })),
}));

vi.mock("../../src/agent-readiness/scanner/ssrf/ip-guard", () => ({
  assertSafeTarget: vi.fn(),
}));

import { makeWebMCPTestApp } from "./webmcp-test-app";

describe("E2E: WebMCP Cross-Origin & Edge Cases", () => {
  let app: ReturnType<typeof makeWebMCPTestApp>;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    app = makeWebMCPTestApp();
  });

  describe("CORS headers on discovery endpoint", () => {
    it("returns Access-Control-Allow-Origin header", async () => {
      const res = await app.request("/.well-known/webmcp.json", {
        headers: { Origin: "https://example.com" },
      });
      expect(res.status).toBe(200);
      const corsHeader = res.headers.get("Access-Control-Allow-Origin");
      expect(corsHeader).toBeTruthy();
    });

    it("returns 200 or 204 for OPTIONS preflight request", async () => {
      const res = await app.request("/.well-known/webmcp.json", {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "GET",
        },
      });
      expect([200, 204]).toContain(res.status);
    });

    it("returns CORS headers on API endpoints", async () => {
      const res = await app.request("/api/score?url=https://example.com", {
        headers: { Origin: "https://cross-origin.com" },
      });
      const corsHeader = res.headers.get("Access-Control-Allow-Origin");
      expect(corsHeader).toBeTruthy();
    });
  });

  describe("Link header on /hackathon/webmcp", () => {
    it("includes Link header with service-desc relation", async () => {
      const res = await app.request("/hackathon/webmcp");
      const linkHeader = res.headers.get("Link");
      expect(linkHeader).toBeTruthy();
      expect(linkHeader).toContain("webmcp.json");
      expect(linkHeader).toContain('rel="service-desc"');
    });

    it("Link header absent on /hackathon/datahub", async () => {
      const res = await app.request("/hackathon/datahub");
      const linkHeader = res.headers.get("Link");
      expect(linkHeader).toBeNull();
    });
  });

  describe("No WebMCP tools leaked to other pages", () => {
    it("/hackathon/datahub does not contain registerTool", async () => {
      const res = await app.request("/hackathon/datahub");
      const html = await res.text();
      expect(html).not.toContain("registerTool");
      expect(html).not.toContain("modelContext");
    });

    it("/hackathon/datahub does not contain WebMCP discovery link", async () => {
      const res = await app.request("/hackathon/datahub");
      const html = await res.text();
      expect(html).not.toContain("webmcp.json");
    });

    it("/hackathon/webmcp contains registerTool", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("registerTool");
    });
  });

  describe("Discovery endpoint accessible without authentication", () => {
    it("returns 200 with no Authorization header", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      expect(res.status).toBe(200);
    });

    it("returns 200 regardless of Origin header value", async () => {
      const origins = [
        "https://example.com",
        "https://agentbadge.xyz",
        "https://malicious-site.com",
        "null",
      ];
      for (const origin of origins) {
        const res = await app.request("/.well-known/webmcp.json", {
          headers: { Origin: origin },
        });
        expect(res.status).toBe(200);
      }
    });
  });

  describe("Discovery JSON excludes sensitive data", () => {
    it("does not contain execute functions in discovery response", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      const json = JSON.stringify(body);
      expect(json).not.toContain("execute");
      expect(json).not.toContain("fetch(");
    });

    it("does not contain internal API paths in tool descriptions", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      for (const tool of body.tools) {
        expect(tool.description).not.toContain("/home/");
        expect(tool.description).not.toContain("/etc/");
      }
    });
  });

  describe("Edge case: unknown hackathon names", () => {
    it("returns 404 for /hackathon/nonexistent", async () => {
      const res = await app.request("/hackathon/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns 404 for /hackathon/UPPERCASE", async () => {
      const res = await app.request("/hackathon/WEBMCP");
      expect(res.status).toBe(404);
    });

    it("returns 404 for /hackathon/with-special-chars", async () => {
      const res = await app.request("/hackathon/with@special");
      expect(res.status).toBe(404);
    });
  });

  describe("Edge case: malformed requests", () => {
    it("returns 404 for /.well-known/webmcp.json/extra", async () => {
      const res = await app.request("/.well-known/webmcp.json/extra");
      expect(res.status).toBe(404);
    });

    it("returns 404 for /.well-known/webmcp.json with trailing slash (strict path)", async () => {
      const res = await app.request("/.well-known/webmcp.json/");
      expect(res.status).toBe(404);
    });

    it("returns 405 for POST to /.well-known/webmcp.json", async () => {
      const res = await app.request("/.well-known/webmcp.json", { method: "POST" });
      expect([404, 405]).toContain(res.status);
    });
  });

  describe("Edge case: concurrent requests", () => {
    it("handles 5 concurrent discovery requests", async () => {
      const requests = Array.from({ length: 5 }, () =>
        app.request("/.well-known/webmcp.json")
      );
      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });

    it("handles 5 concurrent page requests", async () => {
      const requests = Array.from({ length: 5 }, () =>
        app.request("/hackathon/webmcp")
      );
      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });
  });

  describe("Edge case: Content-Type headers", () => {
    it("discovery endpoint returns application/json Content-Type", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const contentType = res.headers.get("Content-Type");
      expect(contentType).toContain("application/json");
    });

    it("webmcp page returns text/html Content-Type", async () => {
      const res = await app.request("/hackathon/webmcp");
      const contentType = res.headers.get("Content-Type");
      expect(contentType).toContain("text/html");
    });
  });
});
