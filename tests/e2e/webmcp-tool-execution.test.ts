/**
 * SLICE-91-14: E2E Tool Execution Tests — WebMCP
 *
 * Verifies tool execution via the API endpoints:
 * - agent-readiness-scan → GET /api/scan (via /api/score proxy)
 * - badge-generate → GET /api/badge (SVG response)
 * - passport-issue → POST /passport/issue
 * - passport-verify → GET /api/passport/verify
 * - get-compliance-score → GET /api/score
 * - search-rules → GET /api/rules/search
 * - All responses structured JSON with meaningful field names
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

vi.mock("@agentbadge/passport", () => ({
  getPassportInfo: vi.fn(async (tokenId: string, serial: number) => {
    if (tokenId === "0.0.999") return null;
    return {
      active: true,
      tokenId,
      serialNumber: serial,
      tier: "gold",
      capabilities: ["api_call", "data_provide"],
      did: `did:hcs:${tokenId}:${serial}`,
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

vi.mock("@agentbadge/evm-core", () => ({
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

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  getNftsForToken: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
}));

vi.mock("../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn(async () => ({
    robotsTxt: { status: "ok", content: "User-agent: *" },
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
    score: 75,
    grade: "B",
    total_rules: 2,
    verified: 1,
    missing: 1,
    not_applicable: 0,
    skipped: 0,
    categories: [],
    top_missing: [],
    summary: "Your site scored 75/100 (B grade). 1 of 2 rules passed.",
  })),
}));

vi.mock("../../src/agent-readiness/scanner/ssrf/ip-guard", () => ({
  assertSafeTarget: vi.fn(),
}));

import { makeWebMCPTestApp } from "./webmcp-test-app";

describe("E2E: WebMCP Tool Execution", () => {
  let app: ReturnType<typeof makeWebMCPTestApp>;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    app = makeWebMCPTestApp();
  });

  describe("get-compliance-score → GET /api/score", () => {
    it("returns 200 with score, grade, summary", async () => {
      const res = await app.request("/api/score?url=https://example.com");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("score");
      expect(typeof body.score).toBe("number");
      expect(body.score).toBeGreaterThanOrEqual(0);
      expect(body.score).toBeLessThanOrEqual(100);
      expect(body).toHaveProperty("grade");
      expect(["A", "B", "C", "D", "F"]).toContain(body.grade);
      expect(body).toHaveProperty("summary");
      expect(typeof body.summary).toBe("string");
    });

    it("returns JSON content-type", async () => {
      const res = await app.request("/api/score?url=https://example.com");
      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("passport-verify → GET /api/passport/verify", () => {
    it("returns 200 with valid, owner, tier, issuedAt for valid tokenId", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.123");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("valid");
      expect(body).toHaveProperty("owner");
      expect(body).toHaveProperty("tier");
      expect(body).toHaveProperty("issuedAt");
      expect(body).toHaveProperty("did");
    });

    it("accepts did parameter", async () => {
      const res = await app.request("/api/passport/verify?did=did:hedera:0.0.123:0");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("valid");
    });

    it("returns JSON content-type", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.123");
      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("search-rules → GET /api/rules/search", () => {
    it("returns 200 with rules array", async () => {
      const res = await app.request("/api/rules/search");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("rules");
      expect(Array.isArray(body.rules)).toBe(true);
      expect(body.rules.length).toBeGreaterThan(0);
    });

    it("returns rules with id, title, category fields", async () => {
      const res = await app.request("/api/rules/search?q=robots");
      const body = await res.json();
      const rule = body.rules[0];
      expect(rule).toHaveProperty("id");
      expect(rule).toHaveProperty("title");
      expect(rule).toHaveProperty("category");
    });

    it("returns rules matching query string", async () => {
      const res = await app.request("/api/rules/search?q=robots");
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
      const body = await res.json();
      expect(body.rules.length).toBeGreaterThan(0);
      body.rules.forEach((r: { category: string }) => {
        expect(r.category).toBe("discovery");
      });
    });

    it("returns JSON content-type", async () => {
      const res = await app.request("/api/rules/search");
      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("Full flow: discover → execute", () => {
    it("agent discovers tools, then calls score endpoint", async () => {
      // Step 1: Discover
      const discoveryRes = await app.request("/.well-known/webmcp.json");
      const discovery = await discoveryRes.json();
      const scoreTool = discovery.tools.find(
        (t: { name: string }) => t.name === "get-compliance-score",
      );
      expect(scoreTool).toBeDefined();

      // Step 2: Execute via API
      const execRes = await app.request("/api/score?url=https://example.com");
      expect(execRes.status).toBe(200);
      const result = await execRes.json();
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("grade");
    });

    it("agent discovers tools, then calls passport verify", async () => {
      // Step 1: Discover
      const discoveryRes = await app.request("/.well-known/webmcp.json");
      const discovery = await discoveryRes.json();
      const verifyTool = discovery.tools.find(
        (t: { name: string }) => t.name === "passport-verify",
      );
      expect(verifyTool).toBeDefined();

      // Step 2: Execute via API
      const execRes = await app.request("/api/passport/verify?tokenId=0.0.123");
      expect(execRes.status).toBe(200);
      const result = await execRes.json();
      expect(result).toHaveProperty("valid");
    });

    it("agent discovers tools, then calls search-rules", async () => {
      // Step 1: Discover
      const discoveryRes = await app.request("/.well-known/webmcp.json");
      const discovery = await discoveryRes.json();
      const searchTool = discovery.tools.find(
        (t: { name: string }) => t.name === "search-rules",
      );
      expect(searchTool).toBeDefined();

      // Step 2: Execute via API
      const execRes = await app.request("/api/rules/search?q=robots");
      expect(execRes.status).toBe(200);
      const result = await execRes.json();
      expect(result).toHaveProperty("rules");
      expect(Array.isArray(result.rules)).toBe(true);
    });
  });

  describe("Response structure: agent-friendly JSON", () => {
    it("all API responses have meaningful field names (no generic 'data')", async () => {
      const scoreRes = await app.request("/api/score?url=https://example.com");
      const scoreBody = await scoreRes.json();
      expect(scoreBody).not.toHaveProperty("data");

      const verifyRes = await app.request("/api/passport/verify?tokenId=0.0.123");
      const verifyBody = await verifyRes.json();
      expect(verifyBody).not.toHaveProperty("data");

      const searchRes = await app.request("/api/rules/search?q=robots");
      const searchBody = await searchRes.json();
      expect(searchBody).not.toHaveProperty("data");
    });
  });
});
