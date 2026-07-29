import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  submitAuditMessage: vi.fn(async () => "0.0.999@1.000"),
  submitDirectoryMessage: vi.fn(async () => "0.0.998@1.000"),
}));

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  upsert: vi.fn(),
  getAll: vi.fn(() => []),
  findByCapability: vi.fn(() => []),
  clear: vi.fn(),
}));

import { Hono } from "hono";
import { agentRoutes } from "../src/server/routes/agents";
import { getNftInfo } from "@agentgate-hedera/hedera-core";
import type { NftInfo } from "@agentgate-hedera/hedera-core";

const VALID_DID = "did:hcs:0.0.1234567:1";
const VALID_TOKEN_ID = "0.0.1234567";
const VALID_SERIAL = 1;
const VALID_ACCOUNT = "0.0.7654321";

function mockNftInfo(): NftInfo {
  return {
    token_id: VALID_TOKEN_ID,
    serial_number: VALID_SERIAL,
    account_id: VALID_ACCOUNT,
    metadata: "ipfs://bafyfake",
    deleted: false,
    created_timestamp: "2024-01-01T00:00:00Z",
  };
}

function validRequestBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    did: VALID_DID,
    tokenId: VALID_TOKEN_ID,
    serial: VALID_SERIAL,
    accountId: VALID_ACCOUNT,
    name: "TestBot",
    capabilities: ["api_call"],
    endpoint: "https://agent.example.com",
    tier: "bronze",
    ...overrides,
  });
}

function mockAgentCardFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        name: "TestBot",
        did: VALID_DID,
        passportTokenId: VALID_TOKEN_ID,
        passportSerial: VALID_SERIAL,
        capabilities: ["api_call"],
        tier: "bronze",
        endpoints: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("Endpoint URL validation — SLICE-7-13", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", agentRoutes);
  });

  it("rejects non-HTTP scheme: file://", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "file:///etc/passwd" }),
    });

    restore();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/endpoint/i);
  });

  it("rejects non-HTTP scheme: ftp://", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "ftp://agent.example.com" }),
    });

    restore();
    expect(res.status).toBe(400);
  });

  it("rejects non-HTTP scheme: javascript://", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "javascript:alert(1)" }),
    });

    restore();
    expect(res.status).toBe(400);
  });

  it("rejects malformed URL (not a URL)", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "not-a-url" }),
    });

    restore();
    expect(res.status).toBe(400);
  });

  it("rejects empty string endpoint", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "" }),
    });

    restore();
    expect(res.status).toBe(400);
  });

  it("accepts valid HTTPS endpoint", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "https://agent.example.com" }),
    });

    restore();
    expect(res.status).toBe(200);
  });

  it("accepts valid HTTP endpoint", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "http://agent.example.com" }),
    });

    restore();
    expect(res.status).toBe(200);
  });

  it("rejects localhost in production mode", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "http://localhost:3000" }),
    });

    process.env.NODE_ENV = originalEnv;
    restore();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/endpoint|localhost/i);
  });

  it("allows localhost in development mode", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "http://localhost:3000" }),
    });

    process.env.NODE_ENV = originalEnv;
    restore();
    expect(res.status).toBe(200);
  });

  it("rejects 127.0.0.1 in production mode", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());
    const restore = mockAgentCardFetch();
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "http://127.0.0.1:3000" }),
    });

    process.env.NODE_ENV = originalEnv;
    restore();
    expect(res.status).toBe(400);
  });

  it("validation runs before Mirror Node check (no NFT call on invalid URL)", async () => {
    vi.mocked(getNftInfo).mockResolvedValueOnce(mockNftInfo());

    const res = await app.request("/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validRequestBody({ endpoint: "file:///etc/passwd" }),
    });

    expect(res.status).toBe(400);
    expect(getNftInfo).not.toHaveBeenCalled();
  });
});
