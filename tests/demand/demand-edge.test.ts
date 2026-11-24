import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  demandRoutes,
  resetDemandRateLimits,
} from "../../src/server/routes/api/demand";
import { createAdminDemandRoutes } from "../../src/server/routes/admin-demand-api";
import { createAdminDemandUi } from "../../src/server/routes/admin-demand-ui";
import {
  pickDemandStore,
  resetDemandMemoryStoreForTests,
  createMemoryDemandStores,
} from "../../src/server/lib/demand/db-stores";
import { ingestDemand } from "../../src/server/lib/demand/pipeline";
import { mintFormToken } from "../../src/server/lib/knowledge/form-tokens";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * EPIC-231 edge cases (231-9 follow-up): boundaries the happy-path
 * specs don't reach —
 *   public adapter: 10/hr limiter, 200-char query cap;
 *   dedupe semantics: session does NOT break the 24h window;
 *   window expiry: >24h same actor+text → NEW canonical, not related;
 *   admin Idempotency-Key length bounds (8..128);
 *   retag absent-vs-null (undefined keeps, null clears);
 *   SSR B-3: Sec-Fetch-Site cross-site POST refused before token.
 */

const HOUR = 3_600_000;

const pubApp = () => {
  const app = new Hono();
  app.route("/", demandRoutes);
  return app;
};
const post = (app: Hono, body: unknown, h: Record<string, string> = {}) =>
  app.request("/api/demand/request", {
    method: "POST",
    headers: { "content-type": "application/json", ...h },
    body: JSON.stringify(body),
  });

const adminApp = () => {
  const store = pickDemandStore({});
  const opStore = createMemoryOperatorStore();
  const app = new Hono();
  app.route("/", createAdminDemandRoutes({ store, operatorStore: opStore }));
  return { app, store, opStore };
};

const admin = (
  app: Hono,
  key: string,
  path: string,
  opts: { method?: string; body?: unknown; idem?: string },
) =>
  app.request(path, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-admin-key": key,
      ...(opts.idem !== undefined ? { "idempotency-key": opts.idem } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

describe("public adapter edges", () => {
  beforeEach(() => {
    resetDemandMemoryStoreForTests();
    resetDemandRateLimits();
    process.env.TRUST_PROXY_HEADERS = "true";
  });
  afterEach(() => delete process.env.TRUST_PROXY_HEADERS);

  it("11th request in the hour → 429 (10/hr bucket)", async () => {
    const app = pubApp();
    const h = { "x-forwarded-for": "172.16.0.9" };
    for (let i = 0; i < 10; i++) {
      const r = await post(app, { capability_query: `q${i}` }, h);
      expect(r.status).toBe(202);
    }
    const eleventh = await post(app, { capability_query: "q11" }, h);
    expect(eleventh.status).toBe(429);
    // A different bucket is unaffected.
    const other = await post(
      app, { capability_query: "q" }, { "x-forwarded-for": "172.16.0.10" },
    );
    expect(other.status).toBe(202);
  });

  it("capability_query: 200 chars → 202, 201 → 400", async () => {
    const app = pubApp();
    const ok = await post(app, { capability_query: "x".repeat(200) });
    expect(ok.status).toBe(202);
    const over = await post(app, { capability_query: "x".repeat(201) });
    expect(over.status).toBe(400);
  });
});

describe("dedupe semantics edges", () => {
  beforeEach(() => resetDemandMemoryStoreForTests());
  const store = () => pickDemandStore({});
  const input = (sessionId?: string) => ({
    text: "escrow payout",
    source: "DEMAND_API" as const,
    declaredLevel: "INTENT" as const,
    sessionId,
  });
  const actor = { resolution: "API_KEY" as const, actorRef: "agent:agb_e" };

  it("different sessionId does NOT break the burst window", async () => {
    const a = await ingestDemand(store(), input("s-1"), actor);
    const b = await ingestDemand(store(), input("s-2"), actor);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.signal.relatedSignalId).toBe(a.signal.id); // folds, no new canonical
    }
    const canon = await store().listSignals({ canonicalOnly: true });
    expect(canon.length).toBe(1);
    expect(canon[0]!.relatedCount).toBe(2);
  });

  it("same actor+text past the 24h window → NEW canonical (re-demand)", async () => {
    const t0 = Date.parse("2026-11-01T00:00:00Z");
    const a = await ingestDemand(store(), input("s-1"), actor, { now: t0 });
    const b = await ingestDemand(
      store(), input("s-3"), actor, { now: t0 + 25 * HOUR },
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.signal.relatedSignalId).toBeNull(); // fresh canonical
      // R1 M3: dedupeKey is actor+text only (window lives on the
      // probe) — same key, but past the window it mints a new row.
      expect(b.signal.dedupeKey).toBe(a.signal.dedupeKey);
    }
    const canon = await store().listSignals({ canonicalOnly: true });
    expect(canon.length).toBe(2);
  });
});

describe("admin mutation edges", () => {
  it("Idempotency-Key bounds: <8 and >128 → 400", async () => {
    const { app, store, opStore } = adminApp();
    const { key } = await seedOperator(opStore);
    const a = await ingestDemand(
      store,
      { text: "x", source: "DEMAND_API", declaredLevel: "INTEREST" },
      { resolution: "ANON", actorRef: "anon:ip:e" },
    );
    if (!a.ok) throw new Error("seed failed");
    const short = await admin(
      app, key, `/api/admin/demand/clusters/${a.cluster.id}/triage`,
      { method: "POST", body: { to: "TRIAGED" }, idem: "short7" },
    );
    expect(short.status).toBe(400);
    const long = await admin(
      app, key, `/api/admin/demand/clusters/${a.cluster.id}/triage`,
      { method: "POST", body: { to: "TRIAGED" }, idem: "k".repeat(129) },
    );
    expect(long.status).toBe(400);
    const ok = await admin(
      app, key, `/api/admin/demand/clusters/${a.cluster.id}/triage`,
      { method: "POST", body: { to: "TRIAGED" }, idem: "k".repeat(8) },
    );
    expect(ok.status).toBe(200);
  });

  it("retag: absent keeps field, null clears it", async () => {
    const { app, store, opStore } = adminApp();
    const { key } = await seedOperator(opStore);
    const a = await ingestDemand(
      store,
      {
        text: "escrow payout",
        source: "DEMAND_API",
        declaredLevel: "INTENT",
        category: "payments",
        feature: "escrow",
      },
      { resolution: "API_KEY", actorRef: "agent:agb_e" },
    );
    if (!a.ok) throw new Error("seed failed");
    // feature: null clears feature; category absent stays "payments".
    const r = await admin(
      app, key, `/api/admin/demand/signals/${a.signal.id}/retag`,
      { method: "POST", body: { feature: null }, idem: "idem-edge-rt1" },
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.signal.category).toBe("payments");
    expect(j.signal.feature).toBeNull();
    // clusterKey re-derived: category only → dict:{cat}|text:{norm}
    expect(j.cluster.clusterKey).toContain("dict:payments|text:");
  });
});

describe("SSR B-3 edge", () => {
  it("cross-site POST refused before token check", async () => {
    const store = createMemoryDemandStores();
    const opStore = createMemoryOperatorStore();
    const app = new Hono();
    app.route("/", createAdminDemandUi(store, opStore));
    const { key } = await seedOperator(opStore, "Op", ["read", "workflow"]);
    const res = await app.request("/admin/demand/clusters/dc_x/triage", {
      method: "POST",
      headers: {
        "x-admin-key": key,
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "cross-site",
      },
      body: new URLSearchParams({
        formToken: mintFormToken(),
        to: "TRIAGED",
      }).toString(),
    });
    expect(res.status).toBe(403);
  });
});
