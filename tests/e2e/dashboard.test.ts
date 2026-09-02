import { describe, it, expect, vi, beforeAll } from "vitest";
import { setupMockEnv, makeTestApp, makeEvmWallet, signWalletOwnership } from "./helpers";
import { issuePassport } from "@agentbadge/passport";
import {
  upsert as upsertDirectory,
  clear as clearDirectory,
} from "@agentbadge/passport";
import type { Hono } from "hono";


describe("SLICE-6-4: Dashboard HTMX E2E", () => {
  let app: Hono;
  let wallet: ReturnType<typeof makeEvmWallet>;
  let signature: string;
  let issuedTokenId: string;
  let issuedSerial: number;

  beforeAll(async () => {
    setupMockEnv();
    clearDirectory();
    app = makeTestApp();

    wallet = makeEvmWallet();
    signature = await signWalletOwnership(wallet.privateKey, wallet.address);

    // Issue a passport so feed/stats have data
    const result = await issuePassport(
      wallet.address,
      signature,
      "silver",
      "DashboardBot",
      ["api_call", "data_provide"],
      "https://dashboard-agent.example.com",
    );
    issuedTokenId = result.tokenId;
    issuedSerial = result.serialNumber;

    // Register agent in directory so /ui/agents has data
    upsertDirectory({
      did: result.did,
      tokenId: issuedTokenId,
      serial: issuedSerial,
      accountId: wallet.address,
      name: "DashboardBot",
      capabilities: ["api_call", "data_provide"],
      endpoint: "https://dashboard-agent.example.com",
      tier: "silver",
      timestamp: Math.floor(Date.now() / 1000),
    });
  });

  it("1. GET / → 200 HTML with #feed, #stats, #audit divs", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="passport-feed"');
    expect(html).toContain('id="stats"');
    expect(html).toContain('id="audit-stream"');
  });

  it("2. GET /ui/feed → 200 with passport entries (HTML fragment)", async () => {
    const res = await app.request("/ui/feed", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Feed fragment shows NFT serial and token ID
    expect(html).toContain(issuedTokenId);
    expect(html).toContain("ACTIVE");
  });

  it("3. GET /ui/stats → 200 with counters (total, active, revoked)", async () => {
    const res = await app.request("/ui/stats", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/total|issued|active|revoked/i);
  });

  it("4. GET /ui/audit → 200 with HCS message entries", async () => {
    const res = await app.request("/ui/audit", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Audit fragment should contain some event type
    expect(html).toMatch(/passport_issued|audit|event/i);
  });

  it("5. GET /ui/passport/:tokenId/:serial → 200 with passport detail card", async () => {
    const res = await app.request(`/ui/passport/${issuedTokenId}/${issuedSerial}`, {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(issuedTokenId);
    expect(html).toContain("silver");
  });

  it("6. GET /ui/agents → 200 with agent directory entries", async () => {
    const res = await app.request("/ui/agents", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("DashboardBot");
  });

  it("7. GET /ui/search → 200 with search form", async () => {
    const res = await app.request("/ui/search", {
      headers: { "HX-Request": "true" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/search|input|form/i);
  });

  it("8. GET /catalog → 200 JSON with tier pricing", async () => {
    const res = await app.request("/catalog");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tiers).toBeDefined();
    expect(Array.isArray(data.tiers)).toBe(true);
    expect(data.tiers).toHaveLength(4);
    const tierNames = data.tiers.map((t: { name: string }) => t.name);
    expect(tierNames).toContain("bronze");
    expect(tierNames).toContain("silver");
    expect(tierNames).toContain("gold");
    expect(tierNames).toContain("platinum");
  });

  it("9. GET /llms.txt → 200 with machine-readable API spec", async () => {
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/passport|agent|catalog|audit/i);
  });
});
