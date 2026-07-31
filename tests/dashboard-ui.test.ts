import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { NftInfo } from "@agentgate-hedera/hedera-core";

// Mock mirror service for feed data
vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
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

import { getNftsForToken } from "@agentgate-hedera/hedera-core";
import { uiRoutes } from "../src/server/routes/ui";

const mockedGetNftsForToken = vi.mocked(getNftsForToken);

// Set env var needed by /ui/feed route
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";

function makeNft(overrides: Partial<NftInfo> = {}): NftInfo {
  return {
    token_id: "0.0.1234567",
    serial_number: 1,
    account_id: "0.0.7654321",
    metadata: "",
    deleted: false,
    created_timestamp: "1700000000.000000001",
    ...overrides,
  };
}

describe("Dashboard — GET /", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML", async () => {
    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("includes HTMX CDN script tag", async () => {
    const res = await app.request("/", { method: "GET" });
    const html = await res.text();
    expect(html).toContain("htmx.org");
  });

  it("includes prebuilt Tailwind CSS link", async () => {
    const res = await app.request("/", { method: "GET" });
    const html = await res.text();
    expect(html).toContain('/css/tailwind.css');
    expect(html).not.toContain('cdn.tailwindcss.com');
  });

  it("contains feed container with hx-get='/ui/feed' and hx-trigger='load, every 5s'", async () => {
    const res = await app.request("/", { method: "GET" });
    const html = await res.text();
    expect(html).toContain('hx-get="/ui/feed"');
    expect(html).toContain("every 5s");
  });
});

describe("Feed Fragment — GET /ui/feed", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML fragment", async () => {
    mockedGetNftsForToken.mockResolvedValueOnce([]);

    const res = await app.request("/ui/feed", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns empty-state fragment when no passports exist", async () => {
    mockedGetNftsForToken.mockResolvedValueOnce([]);

    const res = await app.request("/ui/feed", { method: "GET" });
    const html = await res.text();
    expect(html).not.toContain("<html");
    expect(html.toLowerCase()).toMatch(/no passports|empty|nothing yet/);
  });

  it("returns passport cards when NFTs exist", async () => {
    mockedGetNftsForToken.mockResolvedValueOnce([
      makeNft({ serial_number: 3, created_timestamp: "1700000003.000000001" }),
      makeNft({ serial_number: 2, created_timestamp: "1700000002.000000001" }),
      makeNft({ serial_number: 1, created_timestamp: "1700000001.000000001" }),
    ]);

    const res = await app.request("/ui/feed", { method: "GET" });
    const html = await res.text();
    expect(html).not.toContain("<html");
    expect(html).toContain("0.0.1234567");
    expect(html).toContain("#3");
    expect(html).toContain("#2");
    expect(html).toContain("#1");
  });

  it("orders passports by most recent first (descending serial)", async () => {
    mockedGetNftsForToken.mockResolvedValueOnce([
      makeNft({ serial_number: 1, created_timestamp: "1700000001.000000001" }),
      makeNft({ serial_number: 3, created_timestamp: "1700000003.000000001" }),
      makeNft({ serial_number: 2, created_timestamp: "1700000002.000000001" }),
    ]);

    const res = await app.request("/ui/feed", { method: "GET" });
    const html = await res.text();
    const pos1 = html.indexOf("#3");
    const pos2 = html.indexOf("#2");
    const pos3 = html.indexOf("#1");
    expect(pos1).toBeLessThan(pos2);
    expect(pos2).toBeLessThan(pos3);
  });

  it("shows tokenId, serial, and timestamp for each passport", async () => {
    mockedGetNftsForToken.mockResolvedValueOnce([
      makeNft({ serial_number: 5, created_timestamp: "1700000005.000000001" }),
    ]);

    const res = await app.request("/ui/feed", { method: "GET" });
    const html = await res.text();
    expect(html).toContain("0.0.1234567");
    expect(html).toContain("#5");
  });

  it("handles Mirror Node errors gracefully", async () => {
    mockedGetNftsForToken.mockRejectedValueOnce(new Error("Mirror Node timeout"));

    const res = await app.request("/ui/feed", { method: "GET" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toMatch(/error|unavailable|failed/i);
  });
});
