import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  revokePassport: vi.fn(),
}));

import { revokePassport } from "@agentbadge/passport";
import { adminRoutes } from "../src/server/routes/admin";

const ORIGINAL_API_KEY = process.env.ADMIN_API_KEY;

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", adminRoutes);
  return app;
}

describe("POST /admin/revoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = "test-secret-key";
  });

  afterEach(() => {
    process.env.ADMIN_API_KEY = ORIGINAL_API_KEY;
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
});
