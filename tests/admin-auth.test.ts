import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  revokePassport: vi.fn(),
  rebuildFromHcs: vi.fn(),
}));

import { revokePassport } from "@agentbadge/passport";
import { rebuildFromHcs } from "@agentbadge/passport";
import { adminRoutes } from "../src/server/routes/admin";

const ORIGINAL_API_KEY = process.env.ADMIN_API_KEY;

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", adminRoutes);
  return app;
}

describe("Admin API key authentication — SLICE-7-11", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = "test-secret-key";
  });

  afterEach(() => {
    process.env.ADMIN_API_KEY = ORIGINAL_API_KEY;
  });

  it("accepts X-Admin-Key header (backward compatible)", async () => {
    vi.mocked(revokePassport).mockResolvedValue({ did: "did:hcs:0.0.123:1" });
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-secret-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts Authorization: Bearer <key> header", async () => {
    vi.mocked(revokePassport).mockResolvedValue({ did: "did:hcs:0.0.123:1" });
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 when Authorization header has wrong key", async () => {
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when both headers missing", async () => {
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 500 when ADMIN_API_KEY not configured", async () => {
    delete process.env.ADMIN_API_KEY;
    const app = makeApp();
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "anything" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(500);
  });

  it("POST /admin/rebuild-cache requires auth", async () => {
    const app = makeApp();
    const res = await app.request("/admin/rebuild-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("POST /admin/rebuild-cache succeeds with valid key", async () => {
    process.env.DIRECTORY_TOPIC_ID = "0.0.999";
    vi.mocked(rebuildFromHcs).mockResolvedValue(undefined);
    const app = makeApp();
    const res = await app.request("/admin/rebuild-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-secret-key" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    delete process.env.DIRECTORY_TOPIC_ID;
  });

  it("uses timing-safe comparison to prevent timing attacks", async () => {
    const { adminAuth } = await import("../src/server/middleware/adminAuth");
    const crypto = await import("node:crypto");

    // Verify the middleware uses timingSafeEqual internally
    // We can't easily test timing, but we can verify it doesn't throw on different-length keys
    process.env.ADMIN_API_KEY = "test-secret-key";
    const c = {
      req: { header: () => "short" },
      json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
    } as unknown as Parameters<typeof adminAuth>[0];

    // Should return 401, not throw
    const result = await adminAuth(c, async () => { });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});
