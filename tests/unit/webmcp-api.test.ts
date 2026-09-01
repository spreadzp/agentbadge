import { describe, it, expect, vi } from "vitest";

// Config mock — mutable so individual tests can override chainMode
const mockConfig = {
  chainMode: "hedera" as string,
  hederaNetwork: "testnet",
  ui: {
    currencySymbol: "ℏ",
    chainName: "Hedera Testnet",
    nftStandard: "HIP-412",
    consensus: "HCS",
    explorerTxUrl: "https://hashscan.io/testnet/transaction/",
    explorerAccountUrl: "https://hashscan.io/testnet/account/",
  },
};

vi.mock("../../src/config/env.js", () => ({
  getConfig: vi.fn(() => mockConfig),
  loadConfig: vi.fn(() => ({})),
  resetConfigCache: vi.fn(),
}));

// Mock passport package
vi.mock("@agentbadge/passport", () => ({
  getPassportInfo: vi.fn(async (tokenId: string) => {
    if (tokenId === "0.0.999") return null;
    if (tokenId === "0.0.888") throw new Error("Mirror Node error 400: not found");
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
}));

// Mock local did.ts parseDid (real implementation)
vi.mock("../../src/server/routes/did", () => ({
  parseDid: vi.fn((did: string) => {
    const match = /^did:hcs:(\d+\.\d+\.\d+):(\d+)$/.exec(did);
    if (!match) return null;
    return { tokenId: match[1], serial: Number(match[2]) };
  }),
}));

// Mock @agentbadge/evm-core
vi.mock("@agentbadge/evm-core", () => ({
  isEvmDid: vi.fn((did: string) => /^did:eip155:/.test(did)),
  parseEvmDid: vi.fn((did: string) => {
    const m = /^did:eip155:(\d+):passport:(0x[a-fA-F0-9]{40}):(\d+)$/.exec(did);
    if (!m) return null;
    return { chainId: Number(m[1]), nftAddress: m[2], tokenId: Number(m[3]) };
  }),
}));

// Mock chain-adapter-factory
vi.mock("../../src/server/lib/chain-adapter-factory", () => ({
  getChainAdapter: vi.fn(async () => ({
    getPassportInfo: vi.fn(async (nftAddress: string, tokenId: number) => {
      if (nftAddress === "0x0000000000000000000000000000000000000000") return null;
      return {
        token_id: String(tokenId),
        serial_number: 1,
        account_id: "0xabc123def456",
        metadata: "ipfs://mock",
        deleted: false,
        created_timestamp: "1700000000",
        passportType: "CREATOR",
        capabilities: [],
      };
    }),
  })),
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
        { rule_id: "AB-002", status: "GAP", category: "discovery" },
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

    it("accepts Hedera did parameter (did:hcs:...)", async () => {
      const res = await app.request("/api/passport/verify?did=did:hcs:0.0.123:0");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("valid");
      expect(body).toHaveProperty("owner");
      expect(body).toHaveProperty("tier");
      expect(body).toHaveProperty("issuedAt");
      expect(body).toHaveProperty("did");
    });

    it("accepts EVM did parameter (did:eip155:...)", async () => {
      mockConfig.chainMode = "base";
      try {
        const res = await app.request("/api/passport/verify?did=did:eip155:84532:passport:0x1234567890abcdef1234567890abcdef12345678:1");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("valid");
        expect(body.valid).toBe(true);
        expect(body).toHaveProperty("owner");
        expect(body).toHaveProperty("tier");
        expect(body).toHaveProperty("issuedAt");
        expect(body).toHaveProperty("did");
      } finally {
        mockConfig.chainMode = "hedera";
      }
    });

    it("returns 400 for EVM DID in Hedera chain mode", async () => {
      const res = await app.request("/api/passport/verify?did=did:eip155:84532:passport:0x1234567890abcdef1234567890abcdef12345678:1");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/EVM DIDs are not supported/i);
    });

    it("returns 400 for invalid DID format", async () => {
      const res = await app.request("/api/passport/verify?did=invalid-did");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid DID format");
    });

    it("returns 404 for non-existent EVM passport", async () => {
      mockConfig.chainMode = "base";
      try {
        const res = await app.request("/api/passport/verify?did=did:eip155:84532:passport:0x0000000000000000000000000000000000000000:1");
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.valid).toBe(false);
      } finally {
        mockConfig.chainMode = "hedera";
      }
    });

    it("returns 404 for non-existent tokenId", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.999");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.valid).toBe(false);
    });

    it("returns 404 (not 500) when mirror node throws 400 for tokenId", async () => {
      const res = await app.request("/api/passport/verify?tokenId=0.0.888");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.valid).toBe(false);
      expect(body.error).toBe("Passport not found");
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
