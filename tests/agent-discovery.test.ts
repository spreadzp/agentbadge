import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NftInfo } from "@agentgate-hedera/hedera-core";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
}));

import { getNftInfo } from "@agentgate-hedera/hedera-core";
import { upsert, clear, type DirectoryEntry } from "@agentgate-hedera/passport";
import { agentRoutes } from "../src/server/routes/agents";

const mockedGetNftInfo = vi.mocked(getNftInfo);

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

describe("GET /agents (discovery)", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clear();
  });

  it("returns all entries with active status when no filter", async () => {
    const entry1 = makeEntry("did:hcs:0.0.123:1");
    const entry2 = makeEntry("did:hcs:0.0.123:2", { serial: 2 });
    upsert(entry1);
    upsert(entry2);

    mockedGetNftInfo
      .mockResolvedValueOnce(makeNftInfo("0.0.1234567", 1))
      .mockResolvedValueOnce(makeNftInfo("0.0.1234567", 2));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(2);
    expect(body.agents[0]).toHaveProperty("active", true);
    expect(body.agents[1]).toHaveProperty("active", true);
  });

  it("filters by capability query param", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { capabilities: ["api_call"] }));
    upsert(makeEntry("did:hcs:0.0.123:2", { capabilities: ["data_provide"] }));

    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?capability=api_call"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].capabilities).toContain("api_call");
  });

  it("includes revoked agent with active: false (not filtered out)", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1"));

    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo("0.0.1234567", 1, { deleted: true }));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toHaveProperty("active", false);
  });

  it("returns 200 with empty array when no agents match filter", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { capabilities: ["api_call"] }));

    const res = await agentRoutes.fetch(
      new Request("http://localhost/agents?capability=orchestration"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
  });

  it("returns 200 with empty array when cache is empty", async () => {
    const res = await agentRoutes.fetch(new Request("http://localhost/agents"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
  });

  it("GET /agents/:did returns single agent by DID", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { name: "UniqueBot" }));

    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents/did:hcs:0.0.123:1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent).toBeDefined();
    expect(body.agent.name).toBe("UniqueBot");
    expect(body.agent).toHaveProperty("active", true);
  });

  it("GET /agents/:did returns 404 for unknown DID", async () => {
    const res = await agentRoutes.fetch(new Request("http://localhost/agents/did:hcs:0.0.999:1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("GET /agents/:did returns active: false for revoked passport", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1"));

    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo("0.0.1234567", 1, { deleted: true }));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents/did:hcs:0.0.123:1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent).toHaveProperty("active", false);
  });
});

// ─── SLICE-17-4: Pagination + Skills Filter ─────────────────────

describe("GET /agents (pagination + skills filter)", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clear();
  });

  it("returns paginated results with count, total, limit, offset", async () => {
    for (let i = 1; i <= 15; i++) {
      upsert(makeEntry(`did:hcs:0.0.123:${i}`, { serial: i }));
    }

    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?limit=10&offset=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(10);
    expect(body.count).toBe(10);
    expect(body.total).toBe(15);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  it("returns second page with correct offset", async () => {
    for (let i = 1; i <= 15; i++) {
      upsert(makeEntry(`did:hcs:0.0.123:${i}`, { serial: i }));
    }

    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?limit=10&offset=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(5);
    expect(body.count).toBe(5);
    expect(body.total).toBe(15);
    expect(body.offset).toBe(10);
  });

  it("returns empty agents array when offset beyond total", async () => {
    for (let i = 1; i <= 5; i++) {
      upsert(makeEntry(`did:hcs:0.0.123:${i}`, { serial: i }));
    }

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?limit=10&offset=100"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.total).toBe(5);
  });

  it("clamps limit to 100", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1"));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?limit=500"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it("clamps offset to 0 for negative values", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1"));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?offset=-5"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offset).toBe(0);
  });

  it("filters by skill query param", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { skills: ["data_analysis", "reporting"] }));
    upsert(makeEntry("did:hcs:0.0.123:2", { serial: 2, skills: ["reporting"] }));
    upsert(makeEntry("did:hcs:0.0.123:3", { serial: 3, skills: ["data_analysis"] }));

    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?skill=data_analysis"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(2);
    for (const agent of body.agents) {
      expect(agent.skills).toContain("data_analysis");
    }
  });

  it("filters by capability AND skill (intersection)", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { capabilities: ["api_call"], skills: ["reporting"] }));
    upsert(makeEntry("did:hcs:0.0.123:2", { serial: 2, capabilities: ["api_call"], skills: ["data_analysis"] }));
    upsert(makeEntry("did:hcs:0.0.123:3", { serial: 3, capabilities: ["data_provide"], skills: ["reporting"] }));

    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(
      new Request("http://localhost/agents?capability=api_call&skill=reporting"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].capabilities).toContain("api_call");
    expect(body.agents[0].skills).toContain("reporting");
  });

  it("calls checkActiveStatus only for paginated slice (not all entries)", async () => {
    for (let i = 1; i <= 20; i++) {
      upsert(makeEntry(`did:hcs:0.0.123:${i}`, { serial: i }));
    }

    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents?limit=5&offset=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(5);
    // checkActiveStatus should be called only 5 times (page size), not 20 (total)
    expect(mockedGetNftInfo).toHaveBeenCalledTimes(5);
  });

  it("works without query params (backward compatible, default limit 100)", async () => {
    for (let i = 1; i <= 3; i++) {
      upsert(makeEntry(`did:hcs:0.0.123:${i}`, { serial: i }));
    }

    mockedGetNftInfo.mockResolvedValue(makeNftInfo("0.0.1234567", 1));

    const res = await agentRoutes.fetch(new Request("http://localhost/agents"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(3);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
  });
});
