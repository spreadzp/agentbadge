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

  it("the break-glass verdict refuses safely on short keys (264-9)", async () => {
    const { tryBreakGlassKey } = await import(
      "../../src/server/middleware/operator-breakglass"
    );

    process.env.ADMIN_API_KEY = "test-secret-key";
    process.env.ADMIN_BREAK_GLASS_ENABLED = "true";
    // Should refuse, not throw
    expect(tryBreakGlassKey("short", "/probe")).toEqual({
      accepted: false,
    });
    delete process.env.ADMIN_BREAK_GLASS_ENABLED;
  });

  it("assembled app: adminRoutes use() does not leak onto sibling surfaces (264-8 review)", async () => {
    const { createReviewCenter } = await import(
      "../../src/server/routes/feedback-review/review-center"
    );
    const { createMemoryFeedbackData, createMemoryFeedbackStore } = await import(
      "../../src/server/lib/feedback/store-memory"
    );
    const { createMemoryReviewData, createMemoryReviewStore } = await import(
      "../../src/server/lib/reviews/store-memory"
    );
    const { createMemoryKnowledgeStores } = await import(
      "../../src/server/lib/knowledge/db-stores"
    );
    const { knowledgeDraftPort } = await import(
      "../../src/server/lib/knowledge-draft/port"
    );

    const app = new Hono();
    app.route("/", createAdminRoutes({ operatorStore: store }));
    app.route("/", createReviewCenter({
      operatorStore: store,
      stores: {
        feedback: createMemoryFeedbackStore(createMemoryFeedbackData()),
        reviews: createMemoryReviewStore(createMemoryReviewData()),
        draftPort: knowledgeDraftPort(createMemoryKnowledgeStores()),
      },
    }));

    // The sibling surface keeps its own operatorBrowserAuth — the
    // leaked gate used to return bare 401 with no challenge, so no
    // browser could ever log in.
    const res = await app.request("/admin/review-center");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="operators"',
    );

    // Owned leaves still gated.
    const rev = await app.request("/admin/revoke", { method: "POST" });
    expect(rev.status).toBe(401);
  });
});
