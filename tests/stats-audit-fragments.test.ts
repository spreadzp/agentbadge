import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AuditMessage, TopicMessage, NftInfo } from "@agentbadge/hedera-core";

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

import { getNftsForToken, getTopicMessages } from "@agentbadge/hedera-core";
import { retrieveMetadata } from "@agentbadge/passport";
import { uiRoutes } from "../src/server/routes/ui";

const mockedGetNftsForToken = vi.mocked(getNftsForToken);
const mockedGetTopicMessages = vi.mocked(getTopicMessages);
const mockedRetrieveMetadata = vi.mocked(retrieveMetadata);

process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
process.env.AUDIT_TOPIC_ID = "0.0.9999999";

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

const mockAuditMessages: TopicMessage[] = [
  {
    consensus_timestamp: "1.0",
    message: JSON.stringify({
      type: "passport_issued",
      did: "did:hcs:0.0.1234567:1",
      tokenId: "0.0.1234567",
      serial: 1,
      timestamp: 1700000000,
      tier: "bronze",
      txHash: "0xabc",
    }),
    sequence_number: 1,
    running_hash: "",
  },
  {
    consensus_timestamp: "2.0",
    message: JSON.stringify({
      type: "tier_upgraded",
      did: "did:hcs:0.0.1234567:1",
      tokenId: "0.0.1234567",
      serial: 1,
      timestamp: 1700000001,
      oldTier: "bronze",
      newTier: "gold",
      txHash: "0xdef",
    }),
    sequence_number: 2,
    running_hash: "",
  },
  {
    consensus_timestamp: "3.0",
    message: JSON.stringify({
      type: "agent_registered",
      did: "did:hcs:0.0.1234567:1",
      tokenId: "0.0.1234567",
      serial: 1,
      timestamp: 1700000002,
      txHash: "0xghi",
    }),
    sequence_number: 3,
    running_hash: "",
  },
  {
    consensus_timestamp: "4.0",
    message: JSON.stringify({
      type: "passport_revoked",
      did: "did:hcs:0.0.1234567:2",
      tokenId: "0.0.1234567",
      serial: 2,
      timestamp: 1700000003,
      reason: "compromised",
      txHash: "0xjkl",
    }),
    sequence_number: 4,
    running_hash: "",
  },
  {
    consensus_timestamp: "5.0",
    message: JSON.stringify({
      type: "agent_deregistered",
      did: "did:hcs:0.0.1234567:2",
      tokenId: "0.0.1234567",
      serial: 2,
      timestamp: 1700000004,
      txHash: "0xmno",
    }),
    sequence_number: 5,
    running_hash: "",
  },
];

// ─── GET /ui/stats ──────────────────────────────────────────────

describe("Stats Fragment — GET /ui/stats", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML fragment with total issued, upgrades, tier breakdown", async () => {
    mockedGetNftsForToken.mockResolvedValueOnce([
      makeNft({ serial_number: 1 }),
      makeNft({ serial_number: 2, deleted: true }),
    ]);
    mockedGetTopicMessages.mockResolvedValueOnce(mockAuditMessages);
    mockedRetrieveMetadata
      .mockResolvedValueOnce({
        name: "Agent1",
        description: "Test",
        image: "ipfs://test.png",
        attributes: [],
        did: "did:hcs:0.0.1234567:1",
        tier: "gold",
        capabilities: ["api_call"],
        accountId: "0.0.7654321",
        issuedAt: 1700000000,
        endpoint: "",
        version: 1,
        issuer: "AgentBadge",
      })
      .mockResolvedValueOnce({
        name: "Agent2",
        description: "Test",
        image: "ipfs://test.png",
        attributes: [],
        did: "did:hcs:0.0.1234567:2",
        tier: "bronze",
        capabilities: [],
        accountId: "0.0.7654322",
        issuedAt: 1700000003,
        endpoint: "",
        version: 1,
        issuer: "AgentBadge",
      });

    const res = await app.request("/ui/stats", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("<html");
    // Total issued = 2 (both NFTs exist)
    expect(html).toContain("Issued");
    expect(html).toContain(">2<");
    // Total upgrades = 1 (one tier_upgraded event)
    expect(html).toContain("Upgrades");
    expect(html).toContain(">1<");
    // Tier breakdown should show Gold: 1 (active passport is gold)
    expect(html).toContain("gold");
    expect(html).toContain(">1<");
  });

  it("returns 200 with zero stats when no passports", async () => {
    mockedGetNftsForToken.mockResolvedValueOnce([]);
    mockedGetTopicMessages.mockResolvedValueOnce([]);

    const res = await app.request("/ui/stats", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Issued");
    expect(html).toContain(">0<");
  });

  it("handles missing PASSPORT_TOKEN_ID gracefully", async () => {
    const savedTokenId = process.env.PASSPORT_TOKEN_ID;
    delete process.env.PASSPORT_TOKEN_ID;

    const res = await app.request("/ui/stats", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/not configured|unavailable/i);

    process.env.PASSPORT_TOKEN_ID = savedTokenId;
  });
});

// ─── GET /ui/audit ──────────────────────────────────────────────

describe("Audit Fragment — GET /ui/audit", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML fragment with recent audit events", async () => {
    mockedGetTopicMessages.mockResolvedValueOnce(mockAuditMessages);

    const res = await app.request("/ui/audit", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("<html");
    // All 5 event types should be present
    expect(html).toContain("passport_issued");
    expect(html).toContain("tier_upgraded");
    expect(html).toContain("passport_revoked");
    expect(html).toContain("agent_registered");
    expect(html).toContain("agent_deregistered");
  });

  it("shows old/new tier info for tier_upgraded events", async () => {
    mockedGetTopicMessages.mockResolvedValueOnce(mockAuditMessages);

    const res = await app.request("/ui/audit", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    const html = await res.text();
    expect(html).toContain("bronze");
    expect(html).toContain("gold");
  });

  it("shows reason for passport_revoked events", async () => {
    mockedGetTopicMessages.mockResolvedValueOnce(mockAuditMessages);

    const res = await app.request("/ui/audit", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    const html = await res.text();
    expect(html).toContain("compromised");
  });

  it("returns empty-state when no audit events", async () => {
    mockedGetTopicMessages.mockResolvedValueOnce([]);

    const res = await app.request("/ui/audit", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toMatch(/no.*event|empty|none yet/);
  });

  it("shows DID for each event", async () => {
    mockedGetTopicMessages.mockResolvedValueOnce(mockAuditMessages);

    const res = await app.request("/ui/audit", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    const html = await res.text();
    expect(html).toContain("did:hcs:0.0.1234567:1");
    expect(html).toContain("did:hcs:0.0.1234567:2");
  });
});
