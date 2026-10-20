import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  revokePassport: vi.fn(),
}));

import { revokePassport } from "@agentbadge/passport";
import { adminRoutes } from "../src/server/routes/admin";
import { resetConfigCache } from "../src/config/env";

const ORIGINAL_API_KEY = process.env.ADMIN_API_KEY;
const ORIGINAL_CHAIN_FLAG = process.env.PASSPORT_CHAIN_ENABLED;

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", adminRoutes);
  return app;
}

describe("POST /admin/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = "test-secret-key";
    // SLICE-169-9: revoke is a Hedera-chain call — enable the gate
    // so the handler proceeds (flag off would 503 before validation).
    process.env.PASSPORT_CHAIN_ENABLED = "true";
    resetConfigCache();
  });

  afterEach(() => {
    process.env.ADMIN_API_KEY = ORIGINAL_API_KEY;
    process.env.PASSPORT_CHAIN_ENABLED = ORIGINAL_CHAIN_FLAG;
    resetConfigCache();
  });

  it("returns 401 when X-Admin-Key header is missing", async () => {
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "fraud" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Admin-Key header is wrong", async () => {
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "wrong" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "fraud" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when passport NFT does not exist", async () => {
    vi.mocked(revokePassport).mockRejectedValue(new Error("Passport not found"));
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-secret-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 999, reason: "fraud" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 409 when passport is already revoked (deleted=true)", async () => {
    vi.mocked(revokePassport).mockRejectedValue(new Error("Passport already revoked"));
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-secret-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "fraud" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already revoked/i);
  });

  it("wipes NFT and submits audit message on valid revocation", async () => {
    vi.mocked(revokePassport).mockResolvedValue({ did: "did:hcs:0.0.123:1" });

    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-secret-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "compromised" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.did).toBe("did:hcs:0.0.123:1");

    expect(revokePassport).toHaveBeenCalledWith("0.0.123", 1, "compromised");
  });

  it("returns 400 when tokenId or serial is missing", async () => {
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-secret-key" },
      body: JSON.stringify({ reason: "fraud" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when PASSPORT_CHAIN_ENABLED is off (SLICE-169-9)", async () => {
    process.env.PASSPORT_CHAIN_ENABLED = "";
    resetConfigCache();
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-secret-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "fraud" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("passport_chain_disabled");
    expect(revokePassport).not.toHaveBeenCalled();
  });
});
