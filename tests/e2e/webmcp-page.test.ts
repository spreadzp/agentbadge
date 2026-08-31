/**
 * SLICE-91-14: E2E Page Rendering Tests — WebMCP
 *
 * Verifies the /hackathon/webmcp page:
 * - Returns 200 with WebMCP script
 * - Contains document.modelContext.registerTool for all 6 tools
 * - Contains declarative form with toolname attribute
 * - Tool descriptions visible
 * - Link to /.well-known/webmcp.json
 * - No provideContext or navigator.modelContext
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
  getPassportInfo: vi.fn(async () => null),
  parseDid: vi.fn(() => null),
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
  scanDomain: vi.fn(async () => ({})),
}));

vi.mock("../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: { run: vi.fn(() => ({ assertions: [], rulesetVersion: "1.0", totalRules: 0, applicableRules: 0 })) },
}));

vi.mock("../../src/agent-readiness/report-formatter", () => ({
  formatScanReport: vi.fn(() => ({ url: "", score: 0, grade: "F", summary: "" })),
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

describe("E2E: WebMCP Page Rendering", () => {
  let app: ReturnType<typeof makeWebMCPTestApp>;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    app = makeWebMCPTestApp();
  });

  describe("GET /hackathon/webmcp", () => {
    it("returns 200 with HTML", async () => {
      const res = await app.request("/hackathon/webmcp");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("returns Content-Type text/html", async () => {
      const res = await app.request("/hackathon/webmcp");
      expect(res.headers.get("Content-Type")).toContain("text/html");
    });

    it("contains WebMCP script with registerTool calls", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("document.modelContext.registerTool");
    });

    it("contains await before registerTool calls", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("await document.modelContext.registerTool");
    });

    it("contains all 6 registerTool calls", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      const matches = html.match(/await document\.modelContext\.registerTool\(/g);
      expect(matches).toHaveLength(6);
    });

    it("contains all 6 tool names on the page", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      for (const name of EXPECTED_TOOL_NAMES) {
        expect(html).toContain(name);
      }
    });

    it("contains tool descriptions visible on the page", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("Scan a website for AI agent readiness compliance");
      expect(html).toContain("Generate a compliance badge SVG");
      expect(html).toContain("Issue an AgentBadge passport NFT");
      expect(html).toContain("Verify an AgentBadge passport");
      expect(html).toContain("Get the agent readiness compliance score");
      expect(html).toContain("Search agent readiness rules");
    });

    it("contains link to /.well-known/webmcp.json", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain(".well-known/webmcp.json");
    });

    it("does NOT contain provideContext", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).not.toContain("provideContext");
    });

    it("does NOT contain navigator.modelContext", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).not.toContain("navigator.modelContext");
    });

    it("contains try/catch for graceful failure", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("try {");
      expect(html).toContain("catch");
    });
  });

  describe("Declarative form on /hackathon/webmcp", () => {
    it("contains form with toolname attribute", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain('toolname="submitScanRequest"');
    });

    it("contains tooldescription attribute on form", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("tooldescription=");
    });

    it("contains toolautosubmit attribute on form", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("toolautosubmit");
    });

    it("contains action pointing to /api/scan", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain('action="/api/scan"');
    });

    it("contains input with name=url and type=url", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain('name="url"');
      expect(html).toContain('type="url"');
    });

    it("contains toolparamdescription on input", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("toolparamdescription=");
    });

    it("contains label associated with input", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("<label");
      expect(html).toContain("for=");
    });

    it("contains declarative script with agentInvoked", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("agentInvoked");
    });

    it("contains toolactivated event listener", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("toolactivated");
    });

    it("contains toolcancel event listener", async () => {
      const res = await app.request("/hackathon/webmcp");
      const html = await res.text();
      expect(html).toContain("toolcancel");
    });
  });

  describe("WebMCP not on other pages", () => {
    it("does NOT have registerTool on homepage", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).not.toContain("registerTool");
    });

    it("does NOT have registerTool on /hackathon/datahub", async () => {
      const res = await app.request("/hackathon/datahub");
      const html = await res.text();
      expect(html).not.toContain("registerTool");
    });
  });
});
