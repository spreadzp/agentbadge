import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

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

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  uploadMetadata: vi.fn(),
  retrieveMetadata: vi.fn(),
}));

import { uiRoutes } from "../src/server/routes/ui";

describe("Catalog Fragment — GET /ui/catalog", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", uiRoutes);
  });

  it("returns 200 HTML fragment with 4 tier cards", async () => {
    const res = await app.request("/ui/catalog", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).not.toContain("<html");
    // All 4 tiers
    expect(html).toContain("Bronze");
    expect(html).toContain("Silver");
    expect(html).toContain("Gold");
    expect(html).toContain("Platinum");
  });

  it("shows HBAR prices", async () => {
    const res = await app.request("/ui/catalog", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    const html = await res.text();
    expect(html).toContain("10");
    expect(html).toContain("50");
    expect(html).toContain("200");
    expect(html).toContain("500");
    expect(html).toContain("HBAR");
  });

  it("shows capabilities for each tier", async () => {
    const res = await app.request("/ui/catalog", {
      method: "GET",
      headers: { "HX-Request": "true" },
    });
    const html = await res.text();
    expect(html).toContain("api_call");
    expect(html).toContain("data_provide");
    expect(html).toContain("verified");
    expect(html).toContain("governance");
  });

  it("wraps in Layout on direct browser access", async () => {
    const res = await app.request("/ui/catalog", { method: "GET" });
    const html = await res.text();
    expect(html).toContain("<html");
    expect(html).toContain("AgentGate");
    expect(html).toContain("Catalog");
  });
});
