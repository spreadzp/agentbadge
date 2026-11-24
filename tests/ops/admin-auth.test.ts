import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  revokePassport: vi.fn(),
  rebuildFromHcs: vi.fn(),
}));

import { revokePassport } from "@agentbadge/passport";
import { rebuildFromHcs } from "@agentbadge/passport";
import { createAdminRoutes } from "../../src/server/routes/ops/admin";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";
import type { OperatorStore } from "../../src/server/lib/operators";

const ORIGINAL_API_KEY = process.env.ADMIN_API_KEY;

function makeApp(operatorStore: OperatorStore): Hono {
  const app = new Hono();
  app.route("/", createAdminRoutes({ operatorStore }));
  return app;
}

describe("Operator credential authentication — SLICE-7-11/264-8", () => {
  let store: OperatorStore;
  let key: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = "test-secret-key";
    store = createMemoryOperatorStore();
    ({ key } = await seedOperator(store));
  });

  afterEach(() => {
    process.env.ADMIN_API_KEY = ORIGINAL_API_KEY;
  });

  it("accepts an opk_ credential on the X-Admin-Key transport", async () => {
    vi.mocked(revokePassport).mockResolvedValue({ did: "did:hcs:0.0.123:1" });
    const app = makeApp(store);
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": key },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts Authorization: Bearer <opk_> header", async () => {
    vi.mocked(revokePassport).mockResolvedValue({ did: "did:hcs:0.0.123:1" });
    const app = makeApp(store);
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 when Authorization header has a wrong credential", async () => {
    const app = makeApp(store);
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-key" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when both headers missing", async () => {
    const app = makeApp(store);
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("labels the 401 envelope with UNAUTHORIZED, not INTERNAL_ERROR", async () => {
    const app = makeApp(store);
    const res = await app.request("/admin/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: "0.0.123", serial: 1, reason: "test" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("POST /admin/rebuild-cache requires auth", async () => {
    const app = makeApp(store);
    const res = await app.request("/admin/rebuild-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("POST /admin/rebuild-cache succeeds with a valid credential", async () => {
    process.env.DIRECTORY_TOPIC_ID = "0.0.999";
    vi.mocked(rebuildFromHcs).mockResolvedValue(undefined);
    const app = makeApp(store);
    const res = await app.request("/admin/rebuild-cache", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": key },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    delete process.env.DIRECTORY_TOPIC_ID;
  });

  it("the legacy adminAuth middleware still short-circuits safely on short keys", async () => {
    const { adminAuth } = await import("../../src/server/middleware/adminAuth");

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
