import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  submitAuditMessage: vi.fn(async () => "0.0.999@1.000"),
  submitDirectoryMessage: vi.fn(async () => "0.0.998@1.000"),
}));

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  upsert: vi.fn(),
  getAll: vi.fn(() => []),
  findByCapability: vi.fn(() => []),
  clear: vi.fn(),
}));

import { Hono } from "hono";
import { agentRoutes } from "../src/server/routes/agents";
import { getNftInfo } from "@agentbadge/hedera-core";
import { submitAuditMessage, submitDirectoryMessage } from "@agentbadge/hedera-core";
import { upsert } from "@agentbadge/passport";
import type { NftInfo } from "@agentbadge/hedera-core";

const VALID_DID = "did:hcs:0.0.1234567:1";
const VALID_TOKEN_ID = "0.0.1234567";
const VALID_SERIAL = 1;
const VALID_ACCOUNT = "0.0.7654321";
const VALID_ENDPOINT = "https://agent.example.com";

function mockNftInfo(overrides: Partial<NftInfo> = {}): NftInfo {
  return {
    token_id: VALID_TOKEN_ID,
    serial_number: VALID_SERIAL,
    account_id: VALID_ACCOUNT,
    metadata: "ipfs://bafyfake",
    deleted: false,
    created_timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function validRequestBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    did: VALID_DID,
    tokenId: VALID_TOKEN_ID,
    serial: VALID_SERIAL,
    accountId: VALID_ACCOUNT,
    name: "TradingBot",
    capabilities: ["api_call", "payment", "data_provide"],
    endpoint: VALID_ENDPOINT,
    tier: "silver",
    ...overrides,
  });
}

function mockAgentCardFetch(cardDid: string = VALID_DID, cardName: string = "TradingBot") {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes(".well-known/agent-card.json")) {
      return new Response(
        JSON.stringify({
          name: cardName,
          did: cardDid,
          passportTokenId: VALID_TOKEN_ID,
          passportSerial: VALID_SERIAL,
          capabilities: ["api_call", "payment", "data_provide"],
          tier: "Silver",
          endpoints: {},
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("Not found", { status: 404 });
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function mockAgentCardUnreachable() {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("POST /agents/register", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", agentRoutes);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ did: VALID_DID }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 403 when passport NFT does not exist", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(null);

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody(),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/passport/i);
  });

  it("returns 403 when passport NFT is deleted (revoked)", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo({ deleted: true }));

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody(),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("revoked");
  });

  it("returns 403 when passport NFT owner does not match accountId", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo({ account_id: "0.0.9999999" }));

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody(),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("ownership");
  });

  it("returns 409 when AgentCard DID conflicts with request DID", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch("did:hcs:0.0.999:9");

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody(),
    });

    restore();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("conflict");
  });

  it("proceeds with warning when AgentCard endpoint is unreachable", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardUnreachable();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody(),
    });

    restore();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.warning).toBeDefined();
    expect(body.warning).toContain("AgentCard");
  });

  it("submits directory + audit messages and updates cache on success", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody(),
    });

    restore();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);

    expect(submitDirectoryMessage).toHaveBeenCalledTimes(1);
    const dirMsg = vi.mocked(submitDirectoryMessage).mock.calls[0][0];
    expect(dirMsg.type).toBe("agent_register");
    expect(dirMsg.did).toBe(VALID_DID);
    expect(dirMsg.tokenId).toBe(VALID_TOKEN_ID);
    expect(dirMsg.serial).toBe(VALID_SERIAL);
    expect(dirMsg.accountId).toBe(VALID_ACCOUNT);
    expect(dirMsg.name).toBe("TradingBot");
    expect(dirMsg.capabilities).toEqual(["api_call", "payment", "data_provide"]);
    expect(dirMsg.endpoint).toBe(VALID_ENDPOINT);
    expect(dirMsg.tier).toBe("silver");
    expect(dirMsg.timestamp).toBeTypeOf("number");

    expect(submitAuditMessage).toHaveBeenCalledTimes(1);
    const auditMsg = vi.mocked(submitAuditMessage).mock.calls[0][0];
    expect(auditMsg.type).toBe("agent_registered");
    expect(auditMsg.did).toBe(VALID_DID);

    expect(upsert).toHaveBeenCalledTimes(1);
    const cacheEntry = vi.mocked(upsert).mock.calls[0][0];
    expect(cacheEntry.did).toBe(VALID_DID);
    expect(cacheEntry.name).toBe("TradingBot");
    expect(cacheEntry.capabilities).toEqual(["api_call", "payment", "data_provide"]);
  });

  it("re-registration of same DID succeeds (last-write-wins)", async () => {
    vi.mocked(getNftInfo).mockResolvedValue(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res1 = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ name: "TradingBot" }),
    });

    const res2 = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({
        name: "TradingBotV2",
        endpoint: "https://agent-v2.example.com",
        capabilities: ["api_call", "payment"],
      }),
    });

    restore();
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    expect(upsert).toHaveBeenCalledTimes(2);
    const secondEntry = vi.mocked(upsert).mock.calls[1][0];
    expect(secondEntry.name).toBe("TradingBotV2");
    expect(secondEntry.endpoint).toBe("https://agent-v2.example.com");
  });
});
