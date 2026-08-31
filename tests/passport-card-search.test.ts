import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { NftInfo } from "@agentbadge/hedera-core";

// Mock services
vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftsForToken: vi.fn(),
  getNftInfo: vi.fn(),
  getNftsForAccount: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
  mintPassportNFT: vi.fn(),
  transferNFTToAgent: vi.fn(),
  wipeNFT: vi.fn(),
  updateNftMetadata: vi.fn(),
}));

// Mock IPFS
vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  uploadMetadata: vi.fn(),
  retrieveMetadata: vi.fn(),
}));

import { getNftInfo, getNftsForToken } from "@agentbadge/hedera-core";
import { retrieveMetadata } from "@agentbadge/passport";
import { uiRoutes } from "../src/server/routes/ui";
import { parseSearchQuery } from "../src/views/search-fragment";
import * as directoryCache from "@agentbadge/passport";

const mockedGetNftInfo = vi.mocked(getNftInfo);
const mockedGetNftsForToken = vi.mocked(getNftsForToken);
const mockedRetrieveMetadata = vi.mocked(retrieveMetadata);

process.env.PASSPORT_TOKEN_ID = "0.0.1234567";

function makeNft(overrides: Partial<NftInfo> = {}): NftInfo {
  return {
    token_id: "0.0.1234567",
    serial_number: 1,
    account_id: "0.0.7654321",
    metadata: "ipfs://QmTest",
    deleted: false,
    created_timestamp: "1700000000.000000001",
    ...overrides,
  };
}

// ─── parseSearchQuery ───────────────────────────────────────────

describe("parseSearchQuery", () => {
  it("classifies a DID string", () => {
    const result = parseSearchQuery("did:hcs:0.0.1234567:3");
    expect(result.type).toBe("did");
    expect(result.value).toBe("did:hcs:0.0.1234567:3");
  });

  it("classifies a tokenId-shaped string", () => {
    const result = parseSearchQuery("0.0.1234567");
    expect(result.type).toBe("tokenId");
    expect(result.value).toBe("0.0.1234567");
  });

  it("classifies a plain name string", () => {
    const result = parseSearchQuery("TradingBot");
    expect(result.type).toBe("name");
    expect(result.value).toBe("TradingBot");
  });

  it("classifies empty string as name", () => {
    const result = parseSearchQuery("");
    expect(result.type).toBe("name");
  });
});

// ─── GET /ui/passport/:tokenId/:serial ──────────────────────────

describe("Passport Detail — GET /ui/passport/:tokenId/:serial", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML fragment for an existing passport", async () => {
    const nft = makeNft({ serial_number: 5 });
    mockedGetNftInfo.mockResolvedValueOnce(nft);
    mockedRetrieveMetadata.mockResolvedValueOnce({
      name: "TestAgent",
      description: "Test",
      image: "ipfs://test.png",
      attributes: [],
      did: "did:hcs:0.0.1234567:5",
      tier: "gold",
      capabilities: ["api_call", "payment"],
      accountId: "0.0.7654321",
      issuedAt: 1700000000,
      endpoint: "https://agent.example.com",
      version: 1,
      issuer: "AgentBadge",
    });

    const res = await app.request("/ui/passport/0.0.1234567/5", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("<html");
    expect(html).toContain("did:hcs:0.0.1234567:5");
    expect(html).toContain("gold");
    expect(html).toContain("api_call");
    expect(html).toContain("0.0.7654321");
    expect(html).toContain("hashscan");
  });

  it("returns 200 not-found fragment for missing passport", async () => {
    mockedGetNftInfo.mockResolvedValueOnce(null);

    const res = await app.request("/ui/passport/0.0.9999999/99", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toMatch(/not found|no passport/);
  });

  it("shows REVOKED status for deleted passport", async () => {
    const nft = makeNft({ serial_number: 3, deleted: true });
    mockedGetNftInfo.mockResolvedValueOnce(nft);
    mockedRetrieveMetadata.mockResolvedValueOnce({
      name: "TestAgent",
      description: "Test",
      image: "ipfs://test.png",
      attributes: [],
      did: "did:hcs:0.0.1234567:3",
      tier: "bronze",
      capabilities: [],
      accountId: "0.0.7654321",
      issuedAt: 1700000000,
      endpoint: "",
      version: 1,
      issuer: "AgentBadge",
    });

    const res = await app.request("/ui/passport/0.0.1234567/3", {
      method: "GET",
    });
    const html = await res.text();
    expect(html).toContain("REVOKED");
  });
});

// ─── GET /ui/agents ─────────────────────────────────────────────

describe("Agents Fragment — GET /ui/agents", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockedGetNftsForToken.mockResolvedValue([]);
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML fragment with agent entries", async () => {
    vi.spyOn(directoryCache, "getAll").mockReturnValue([
      {
        did: "did:hcs:0.0.1234567:1",
        tokenId: "0.0.1234567",
        serial: 1,
        accountId: "0.0.7654321",
        name: "TradingBot",
        capabilities: ["api_call", "payment"],
        endpoint: "https://agent1.example.com",
        tier: "gold",
        timestamp: 1700000000,
      },
    ]);
    mockedGetNftsForToken.mockResolvedValueOnce([makeNft({ serial_number: 1 })]);
    mockedGetNftInfo.mockResolvedValueOnce(makeNft({ serial_number: 1 }));

    const res = await app.request("/ui/agents", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("<html");
    expect(html).toContain("TradingBot");
    expect(html).toContain("api_call");
    expect(html).toContain("did:hcs:0.0.1234567:1");
  });

  it("returns empty-state when no agents registered", async () => {
    vi.spyOn(directoryCache, "getAll").mockReturnValue([]);
    mockedGetNftsForToken.mockResolvedValueOnce([]);

    const res = await app.request("/ui/agents", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toMatch(/no agents|empty|none yet/);
  });

  it("shows active/inactive indicator", async () => {
    vi.spyOn(directoryCache, "getAll").mockReturnValue([
      {
        did: "did:hcs:0.0.1234567:2",
        tokenId: "0.0.1234567",
        serial: 2,
        accountId: "0.0.7654321",
        name: "InactiveBot",
        capabilities: ["data_provide"],
        endpoint: "https://agent2.example.com",
        tier: "bronze",
        timestamp: 1700000000,
      },
    ]);
    mockedGetNftsForToken.mockResolvedValueOnce([makeNft({ serial_number: 2, deleted: true })]);
    mockedGetNftInfo.mockResolvedValueOnce(makeNft({ serial_number: 2, deleted: true }));

    const res = await app.request("/ui/agents", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    const html = await res.text();
    expect(html).toContain("INACTIVE");
  });
});

// ─── GET /ui/search ─────────────────────────────────────────────

describe("Search Fragment — GET /ui/search", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockedGetNftsForToken.mockResolvedValue([]);
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns search form with no query", async () => {
    const res = await app.request("/ui/search", { method: "GET" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("hx-get");
    expect(html).toContain("/ui/search");
  });

  it("returns matching agents by name", async () => {
    const nft1 = makeNft({ serial_number: 1 });
    const nft2 = makeNft({ serial_number: 2 });
    vi.spyOn(directoryCache, "getAll").mockReturnValue([
      {
        did: "did:hcs:0.0.1234567:1",
        tokenId: "0.0.1234567",
        serial: 1,
        accountId: "0.0.7654321",
        name: "TradingBot",
        capabilities: ["api_call"],
        endpoint: "https://agent1.example.com",
        tier: "gold",
        timestamp: 1700000000,
      },
      {
        did: "did:hcs:0.0.1234567:2",
        tokenId: "0.0.1234567",
        serial: 2,
        accountId: "0.0.7654322",
        name: "DataBot",
        capabilities: ["data_consume"],
        endpoint: "https://agent2.example.com",
        tier: "silver",
        timestamp: 1700000001,
      },
    ]);
    mockedGetNftsForToken.mockResolvedValueOnce([nft1, nft2]);
    mockedGetNftInfo.mockResolvedValue(makeNft({ serial_number: 1 }));

    const res = await app.request("/ui/search?q=Trading", { method: "GET" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("TradingBot");
    expect(html).not.toContain("DataBot");
  });

  it("returns empty-state for no matches", async () => {
    vi.spyOn(directoryCache, "getAll").mockReturnValue([]);
    mockedGetNftsForToken.mockResolvedValueOnce([]);

    const res = await app.request("/ui/search?q=nonexistent", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toMatch(/no results|nothing found|no match/);
  });

  it("searches by DID and finds passport", async () => {
    const nft7 = makeNft({ serial_number: 7 });
    vi.spyOn(directoryCache, "getAll").mockReturnValue([
      {
        did: "did:hcs:0.0.1234567:7",
        tokenId: "0.0.1234567",
        serial: 7,
        accountId: "0.0.7654321",
        name: "DIDBot",
        capabilities: ["orchestration"],
        endpoint: "https://agent.example.com",
        tier: "platinum",
        timestamp: 1700000000,
      },
    ]);
    mockedGetNftsForToken.mockResolvedValueOnce([nft7]);
    mockedGetNftInfo.mockResolvedValue(makeNft({ serial_number: 7 }));

    const res = await app.request("/ui/search?q=did:hcs:0.0.1234567:7", { method: "GET" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("DIDBot");
  });
});
