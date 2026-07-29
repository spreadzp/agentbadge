import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";


import { setupMockEnv, makeTestApp, makeEvmWallet, signWalletOwnership } from "./helpers";
import { nftStore, topicMessages } from "@agentgate-hedera/hedera-core";

describe("SLICE-6-1: Passport Lifecycle E2E", () => {
  let app: ReturnType<typeof makeTestApp>;
  let wallet: ReturnType<typeof makeEvmWallet>;
  let signature: string;
  let issuedTokenId: string;
  let issuedSerial: number;

  beforeAll(() => {
    setupMockEnv();
    app = makeTestApp();
    wallet = makeEvmWallet();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupMockEnv();
  });

  it("1. POST /passport/request → 200 with { tokenId, serial, did, hashScanLink }", async () => {
    signature = await signWalletOwnership(wallet.privateKey, wallet.address);

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: wallet.address,
        signature,
        tier: "silver",
        name: "LifecycleBot",
        capabilities: ["api_call", "payment", "data_provide"],
        endpoint: "https://agent.example.com",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokenId).toBeDefined();
    expect(body.serialNumber).toBeTypeOf("number");
    expect(body.did).toMatch(/^did:hcs:/);
    expect(body.hashScanLink).toContain("hashscan.io");
    expect(body.tier).toBe("silver");

    issuedTokenId = body.tokenId;
    issuedSerial = body.serialNumber;
  });

  it("2. GET /passport/:tokenId/:serial → passport with correct tier, status active", async () => {
    const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("silver");
    expect(body.active).toBe(true);
    expect(body.did).toBe(`did:hcs:${issuedTokenId}:${issuedSerial}`);
    expect(body.owner).toBe(wallet.address);
    expect(body.capabilities).toEqual(["api_call", "payment", "data_provide"]);
  });

  it("3. POST /passport/:tokenId/:serial/upgrade → 200 with new tier", async () => {
    const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newTier: "gold",
        accountId: wallet.address,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("gold");
    expect(body.tokenId).toBe(issuedTokenId);
    expect(body.serialNumber).toBe(issuedSerial);
  });

  it("4. GET /passport/:tokenId/:serial → reflects upgraded tier", async () => {
    const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("gold");
    expect(body.active).toBe(true);
  });

  it("5. POST /admin/revoke → 200, passport status becomes revoked", async () => {
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": "test-admin-key",
      },
      body: JSON.stringify({
        tokenId: issuedTokenId,
        serial: issuedSerial,
        reason: "E2E test revocation",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.did).toBe(`did:hcs:${issuedTokenId}:${issuedSerial}`);
  });

  it("6. GET /passport/:tokenId/:serial → verify revoked status (active=false)", async () => {
    const res = await app.request(`/passport/${issuedTokenId}/${issuedSerial}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
  });

  it("7. GET /audit/:tokenId/:serial → audit trail contains issued, upgraded, revoked", async () => {
    const res = await app.request(`/audit/${issuedTokenId}/${issuedSerial}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBe(true);

    const types = body.events.map((e: { type: string }) => e.type);
    expect(types).toContain("passport_issued");
    expect(types).toContain("tier_upgraded");
    expect(types).toContain("passport_revoked");
  });
});
