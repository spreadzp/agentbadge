/**
 * SLICE-91-14: E2E Discovery Tests — WebMCP
 *
 * Verifies the full discovery flow:
 * - GET /.well-known/webmcp.json returns 200 with all 6 tools
 * - JSON validates against schema
 * - Link header on /hackathon/webmcp includes webmcp.json reference
 * - Endpoint accessible without authentication
 * - Correct Content-Type
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

const EXPECTED_TOOL_NAMES = [
  "agent-readiness-scan",
  "badge-generate",
  "passport-issue",
  "passport-verify",
  "get-compliance-score",
  "search-rules",
];

describe("E2E: WebMCP Discovery", () => {
  let app: ReturnType<typeof makeWebMCPTestApp>;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    app = makeWebMCPTestApp();
  });

  describe("GET /.well-known/webmcp.json", () => {
    it("returns 200", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      expect(res.status).toBe(200);
    });

    it("returns Content-Type application/json", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      expect(res.headers.get("Content-Type")).toContain("application/json");
    });

    it("returns Cache-Control header", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      expect(res.headers.get("Cache-Control")).not.toBeNull();
    });

    it("returns valid JSON with tools array", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      expect(body).toHaveProperty("tools");
      expect(Array.isArray(body.tools)).toBe(true);
    });

    it("includes all 6 imperative tools", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      expect(body.tools.length).toBe(6);
      const names = body.tools.map((t: { name: string }) => t.name);
      for (const expected of EXPECTED_TOOL_NAMES) {
        expect(names).toContain(expected);
      }
    });

    it("each tool has name, description, inputSchema", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      for (const tool of body.tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool).toHaveProperty("inputSchema");
        expect(tool.inputSchema).toHaveProperty("type", "object");
        expect(tool.inputSchema).toHaveProperty("properties");
        expect(tool.inputSchema).toHaveProperty("required");
      }
    });

    it("each tool has annotations with readOnlyHint and untrustedContentHint", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      for (const tool of body.tools) {
        expect(tool).toHaveProperty("annotations");
        expect(tool.annotations).toHaveProperty("readOnlyHint");
        expect(tool.annotations).toHaveProperty("untrustedContentHint");
      }
    });

    it("does not include execute functions in output", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      for (const tool of body.tools) {
        expect(tool).not.toHaveProperty("execute");
      }
    });

    it("is accessible without authentication (no Authorization header)", async () => {
      const res = await app.request("/.well-known/webmcp.json", {
        headers: {},
      });
      expect(res.status).toBe(200);
    });

    it("tool names are ≤30 chars", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      for (const tool of body.tools) {
        expect(tool.name.length).toBeLessThanOrEqual(30);
      }
    });

    it("tool descriptions are ≤500 chars", async () => {
      const res = await app.request("/.well-known/webmcp.json");
      const body = await res.json();
      for (const tool of body.tools) {
        expect(tool.description.length).toBeLessThanOrEqual(500);
      }
    });
  });

  describe("Link header on /hackathon/webmcp", () => {
    it("includes webmcp.json reference in Link header", async () => {
      const res = await app.request("/hackathon/webmcp");
      const link = res.headers.get("Link");
      expect(link).not.toBeNull();
      expect(link).toContain(".well-known/webmcp.json");
      expect(link).toContain("service-desc");
    });
  });

  describe("Full discovery → page flow", () => {
    it("agent can discover tools and navigate to hackathon page", async () => {
      // Step 1: Discover tools via well-known
      const discoveryRes = await app.request("/.well-known/webmcp.json");
      expect(discoveryRes.status).toBe(200);
      const discovery = await discoveryRes.json();
      expect(discovery.tools.length).toBe(6);

      // Step 2: Navigate to hackathon page
      const pageRes = await app.request("/hackathon/webmcp");
      expect(pageRes.status).toBe(200);
      const html = await pageRes.text();
      expect(html).toContain("document.modelContext.registerTool");

      // Verify all discovered tools are registered on the page
      for (const tool of discovery.tools) {
        expect(html).toContain(tool.name);
      }
    });
  });
});
