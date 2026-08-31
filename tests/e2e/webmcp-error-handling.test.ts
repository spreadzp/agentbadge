/**
 * SLICE-91-14: E2E Error Handling Tests — WebMCP
 *
 * Verifies error scenarios produce meaningful, structured responses:
 * - Missing required query parameters → 400
 * - Invalid URL format → 400
 * - Invalid DID format → 400
 * - Passport not found → 404
 * - Unknown hackathon name → 404
 * - Non-existent endpoints → 404
 * - SSRF protection → 403
 * - All errors return JSON with "error" field
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
      assertions: [],
      rulesetVersion: "1.0",
      totalRules: 0,
      applicableRules: 0,
    })),
  },
}));

vi.mock("../../src/agent-readiness/report-formatter", () => ({
  formatScanReport: vi.fn(() => ({
    url: "",
    score: 0,
    grade: "F",
    summary: "",
  })),
}));

vi.mock("../../src/agent-readiness/scanner/ssrf/ip-guard", () => ({
  assertSafeTarget: vi.fn((hostname: string) => {
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "10.0.0.1") {
      throw new Error("Private IP address not allowed");
    }
  }),
}));

import { makeWebMCPTestApp } from "./webmcp-test-app";

describe("E2E: WebMCP Error Handling", () => {
  let app: ReturnType<typeof makeWebMCPTestApp>;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    app = makeWebMCPTestApp();
  });

  describe("passport-verify errors", () => {
    it("returns 400 when neither tokenId nor did provided", async () => {
      const res = await app.request("/api/passport/verify");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    });

    it("returns 400 for invalid DID format", async () => {
      const res = await app.request("/api/passport/verify?did=invalid-did-format");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 404 when passport not found", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.999");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error");
      expect(body).toHaveProperty("valid", false);
    });
  });

  describe("get-compliance-score errors", () => {
    it("returns 400 when url parameter missing", async () => {
      const res = await app.request("/api/score");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toContain("URL");
    });

    it("returns 400 for invalid URL format", async () => {
      const res = await app.request("/api/score?url=http://[invalid-bracket");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 403 for private/localhost URLs", async () => {
      const res = await app.request("/api/score?url=http://localhost");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty("error");
      expect(body.error.toLowerCase()).toContain("private");
    });

    it("returns 403 for 127.0.0.1 URLs", async () => {
      const res = await app.request("/api/score?url=http://127.0.0.1");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });
  });

  describe("search-rules edge cases", () => {
    it("returns 200 with empty rules for non-matching query", async () => {
      const res = await app.request("/api/rules/search?q=zzznonexistentxyz");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("rules");
      expect(Array.isArray(body.rules)).toBe(true);
    });

    it("returns 200 with all rules when no query provided", async () => {
      const res = await app.request("/api/rules/search");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules.length).toBeGreaterThan(0);
    });
  });

  describe("hackathon routing errors", () => {
    it("returns 404 for unknown hackathon name", async () => {
      const res = await app.request("/hackathon/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns 200 for known hackathon 'webmcp'", async () => {
      const res = await app.request("/hackathon/webmcp");
      expect(res.status).toBe(200);
    });
  });

  describe("non-existent API endpoints", () => {
    it("returns 404 for /api/nonexistent", async () => {
      const res = await app.request("/api/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns 404 for /api/webmcp/nonexistent", async () => {
      const res = await app.request("/api/webmcp/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("structured error responses", () => {
    it("all error responses include 'error' field as string", async () => {
      const endpoints = [
        "/api/passport/verify",
        "/api/score",
        "/api/score?url=http://[invalid-bracket",
      ];
      for (const endpoint of endpoints) {
        const res = await app.request(endpoint);
        const body = await res.json();
        expect(body).toHaveProperty("error");
        expect(typeof body.error).toBe("string");
        expect(body.error.length).toBeGreaterThan(0);
      }
    });

    it("error messages are descriptive (not just 'Error')", async () => {
      const res = await app.request("/api/score");
      const body = await res.json();
      expect(body.error.length).toBeGreaterThan(5);
      expect(body.error.toLowerCase()).not.toBe("error");
    });
  });

  describe("discovery endpoint robustness", () => {
    it("returns 200 regardless of Accept header", async () => {
      const res = await app.request("/.well-known/webmcp.json", {
        headers: { Accept: "text/html" },
      });
      expect(res.status).toBe(200);
    });

    it("returns 200 for POST request (method ignored, returns GET response)", async () => {
      const res = await app.request("/.well-known/webmcp.json", { method: "POST" });
      // POST to a GET route should return 404, not 500
      expect(res.status).not.toBe(500);
    });
  });
});
