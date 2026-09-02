/**
 * SLICE-17-11: E2E Agent Discovery Workflow Test
 *
 * Simulates an AI agent discovering and using AgentBadge end-to-end.
 * Uses Hono's app.fetch() (no network server needed).
 * MOCK_HEDERA=true — no real Hedera calls.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { NftInfo } from "@agentbadge/hedera-core";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  getNftsForToken: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
}));

import { getNftInfo, getNftsForToken } from "@agentbadge/hedera-core";
import { upsert, clear, type DirectoryEntry } from "@agentbadge/passport";
import { createApp } from "../../src/server/index";

const mockedGetNftInfo = vi.mocked(getNftInfo);
const mockedGetNftsForToken = vi.mocked(getNftsForToken);

function makeEntry(did: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    did,
    tokenId: "0.0.1234567",
    serial: 1,
    accountId: "0.0.7654321",
    name: "TestBot",
    capabilities: ["api_call", "data_provide"],
    endpoint: "https://agent.test",
    tier: "bronze",
    timestamp: Math.floor(Date.now() / 1000),
    skills: ["data_analysis"],
    ...overrides,
  };
}

function makeNftInfo(tokenId: string, serial: number, overrides: Partial<NftInfo> = {}): NftInfo {
  return {
    token_id: tokenId,
    serial_number: serial,
    account_id: "0.0.7654321",
    metadata: "",
    deleted: false,
    created_timestamp: "1700000000.000000001",
    ...overrides,
  };
}

describe("E2E: Agent Discovery Workflow", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    app = createApp();
  });

  beforeEach(() => {
    clear();
    vi.clearAllMocks();
    // Seed 3 agents
    upsert(makeEntry("did:hcs:0.0.1234567:1", { name: "AlphaBot", serial: 1, skills: ["data_analysis"] }));
    upsert(makeEntry("did:hcs:0.0.1234567:2", { name: "BetaBot", serial: 2, skills: ["translation"], capabilities: ["api_call", "payment"] }));
    upsert(makeEntry("did:hcs:0.0.1234567:3", { name: "GammaBot", serial: 3, skills: ["orchestration"], capabilities: ["data_consume", "orchestration"] }));
    // Mock NFT info for active status
    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));
    mockedGetNftsForToken.mockResolvedValue([
      makeNftInfo("0.0.1234567", 1),
      makeNftInfo("0.0.1234567", 2),
      makeNftInfo("0.0.1234567", 3),
    ]);
  });

  afterAll(() => {
    clear();
  });

  // ─── Phase 1: Discovery ───────────────────────────────────────

  describe("Phase 1: Discovery", () => {
    it("GET /.well-known/agent-card.json → 200 with name, capabilities, endpoints, payment", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      expect(res.status).toBe(200);
      const card = await res.json();
      expect(card).toHaveProperty("name");
      expect(card).toHaveProperty("capabilities");
      expect(card.capabilities).toBeInstanceOf(Array);
      expect(card).toHaveProperty("endpoints");
      expect(card).toHaveProperty("payment");
    });

    it("Agent Card endpoints.llms_txt points to /llms.txt", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      const card = await res.json();
      expect(card.endpoints.llms_txt).toContain("/llms.txt");
    });

    it("Agent Card payment.protocol is 'x402'", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      const card = await res.json();
      expect(card.payment.protocol).toBe("x402");
    });

    it("GET /ai-sitemap.xml → 200, valid XML with resources", async () => {
      const res = await app.request("/ai-sitemap.xml");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<?xml");
      expect(text).toContain("<resources");
      expect(text).toContain("</resources>");
    });
  });

  // ─── Phase 2: Understanding ───────────────────────────────────

  describe("Phase 2: Understanding", () => {
    it("GET /llms.txt → 200 with machine-readable content", async () => {
      const res = await app.request("/llms.txt");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(100);
    });

    it("GET /agent-guide → 200 with markdown content", async () => {
      const res = await app.request("/agent-guide");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.trim().startsWith("#")).toBe(true);
    });

    it("GET /api/specs → 200 with valid OpenAPI JSON", async () => {
      const res = await app.request("/api/specs");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("paths");
      expect(body.paths).toBeInstanceOf(Object);
    });

    it("GET /catalog → 200 with tiers array", async () => {
      const res = await app.request("/catalog");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("tiers");
      expect(body.tiers).toBeInstanceOf(Array);
      expect(body.tiers.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ─── Phase 3: Interaction ─────────────────────────────────────

  describe("Phase 3: Interaction", () => {
    it("GET /agents?limit=5 → 200 with paginated shape", async () => {
      const res = await app.request("/agents?limit=5");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("agents");
      expect(body).toHaveProperty("count");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("limit");
      expect(body).toHaveProperty("offset");
    });

    it("GET /agents?skill=data_analysis → 200 with filtered results", async () => {
      const res = await app.request("/agents?skill=data_analysis");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agents).toBeInstanceOf(Array);
      // At least one agent with data_analysis skill
      if (body.agents.length > 0) {
        expect(body.agents[0].skills).toContain("data_analysis");
      }
    });

    it("GET /api/search?q=test → 200 with search results shape", async () => {
      const res = await app.request("/api/search?q=test");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("query");
      expect(body).toHaveProperty("results");
      expect(body).toHaveProperty("count");
    });

    it("GET /market/tasks?limit=5 → 200 with tasks shape", async () => {
      const res = await app.request("/market/tasks?limit=5");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("tasks");
      expect(body).toHaveProperty("count");
      expect(body).toHaveProperty("total");
    });
  });

  // ─── Phase 4: Error Handling ──────────────────────────────────

  describe("Phase 4: Error Handling", () => {
    it("POST /agents/register with empty body → 400 with error code", async () => {
      const res = await app.request("/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("code");
      expect(body).toHaveProperty("error");
    });

    it("GET /agents/unknown-did → 404 with error code", async () => {
      const res = await app.request("/agents/did:hcs:0.0.999:999");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("code");
      expect(body).toHaveProperty("error");
    });
  });

  // ─── Phase 5: Navigation ──────────────────────────────────────

  describe("Phase 5: Navigation", () => {
    it("GET /agents → agents have _links with self", async () => {
      const res = await app.request("/agents");
      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.agents.length > 0) {
        expect(body.agents[0]).toHaveProperty("_links");
        expect(body.agents[0]._links).toHaveProperty("self");
      }
    });

    it("GET /market/tasks → tasks have _links with self", async () => {
      const res = await app.request("/market/tasks");
      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.tasks.length > 0) {
        expect(body.tasks[0]).toHaveProperty("_links");
        expect(body.tasks[0]._links).toHaveProperty("self");
      }
    });
  });

  // ─── Phase 6: Content Negotiation ─────────────────────────────

  describe("Phase 6: Content Negotiation", () => {
    it("GET /ui/catalog without Accept → HTML", async () => {
      const res = await app.request("/ui/catalog");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<html");
    });

    it("GET /ui/catalog with Accept: application/json → JSON with tiers", async () => {
      const res = await app.request("/ui/catalog", {
        headers: { Accept: "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("tiers");
    });

    it("GET /ui/catalog with Accept: text/markdown → markdown table", async () => {
      const res = await app.request("/ui/catalog", {
        headers: { Accept: "text/markdown" },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("# AgentBadge Passport Tiers");
      expect(text).toContain("| Tier |");
    });
  });

  // ─── Phase 8: Page Titles ─────────────────────────────────────

  describe("Phase 8: Page Titles", () => {
    it("GET / → HTML contains <title>", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<title>");
      expect(html).toContain("</title>");
    });

    it("GET /ui/catalog → HTML contains unique <title>", async () => {
      const res = await app.request("/ui/catalog");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<title>");
      expect(html).toContain("Passport Tiers");
    });

    it("two different pages have different titles", async () => {
      const homeRes = await app.request("/");
      const homeHtml = await homeRes.text();
      const homeTitle = homeHtml.match(/<title>(.*?)<\/title>/)?.[1];

      const catalogRes = await app.request("/ui/catalog");
      const catalogHtml = await catalogRes.text();
      const catalogTitle = catalogHtml.match(/<title>(.*?)<\/title>/)?.[1];

      expect(homeTitle).toBeDefined();
      expect(catalogTitle).toBeDefined();
      expect(homeTitle).not.toBe(catalogTitle);
    });
  });
});
