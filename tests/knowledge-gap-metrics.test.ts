import { afterAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createDatabase, type Database } from "@agentbadge/database";

import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import {
  createMemoryKnowledgeStores,
  DbKnowledgeStore,
  gapOverdueId,
  recordGap,
  type KnowledgeGapRecord,
  type KnowledgeStore,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../src/server/routes/admin-knowledge-api";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "./helpers/operators";

/**
 * SLICE-264-14 — the accountability digest: exact counts from
 * real aggregates (3 overdue + 2 resolved → exact numbers), an
 * empty queue → zeros not NaN/500, durable breachesTotal, the
 * ?days= clear-window, and admin-only access (O-264-11: a public
 * projection is deferred).
 */

const PAST = "2020-01-01T00:00:00.000Z";

/** PG-native stamps ("…ss+00", no colon) break Date.parse —
 *  same normalize as the shared gapTsMs. */
const tsMs = (s: string) =>
  Date.parse(
    (s.includes("T") ? s : s.replace(" ", "T")).replace(
      /([+-]\d{2})$/,
      "$1:00",
    ),
  );

/** Unique-query seed — recordGap upserts by normalizedQuery, so a
 *  shared query would merge every seed into one row (mkGap's fixed
 *  "escrow settlement" text is unusable for multi-gap setups). */
async function mkGap(store: KnowledgeStore): Promise<KnowledgeGapRecord> {
  const r = await recordGap(store, {
    query: `m ${gapOverdueId()}`,
    source: "MANUAL",
  });
  if (!r.ok || !r.gap) throw new Error("gap seed failed");
  return r.gap;
}

/** Overdue seed: an assigned gap with a past deadline. */
async function mkOverdue(store: KnowledgeStore) {
  const g = await mkGap(store);
  await store.assignGap(g.id, {
    assignedTo: "op_a",
    assignedBy: "op_a",
    assignedAt: new Date().toISOString(),
    dueAt: PAST,
    expectedAssignedTo: null,
  });
  return g;
}

/** Resolved seed with a controlled clear time (firstSeenAt + secs). */
async function mkResolved(store: KnowledgeStore, secs: number) {
  const g = await mkGap(store);
  await store.transitionGap(g.id, {
    from: "OPEN",
    to: "TRIAGED",
    resolvedAt: null,
  });
  const resolvedAt = new Date(tsMs(g.firstSeenAt) + secs * 1000).toISOString();
  await store.transitionGap(g.id, {
    from: "TRIAGED",
    to: "RESOLVED",
    resolvedAt,
  });
}

async function mkApp() {
  resetIdempotencyStore();
  const store = createMemoryKnowledgeStores();
  const operators = createMemoryOperatorStore();
  const admin = await seedOperator(operators, "Admin");
  const app = new Hono();
  app.route(
    "/",
    createAdminKnowledgeRoutes({ store, operatorStore: operators }),
  );
  return { app, store, admin };
}

describe("264-14: gap accountability metrics", () => {
  it("exact numbers: 3 overdue + 1 unassigned + 2 resolved + 2 breach rows", async () => {
    const { app, store, admin } = await mkApp();
    await mkOverdue(store);
    await mkOverdue(store);
    const o3 = await mkOverdue(store);
    await mkGap(store); // unassigned OPEN → the pick-up pool
    await mkResolved(store, 100);
    await mkResolved(store, 200);
    await store.recordOverdue({
      id: `kgo_${o3.id}_1`,
      gapId: o3.id,
      dueAt: PAST,
    });
    await store.recordOverdue({
      id: `kgo_${o3.id}_2`,
      gapId: o3.id,
      dueAt: "2020-01-02T00:00:00.000Z",
    });

    const now = new Date().toISOString();
    const m = await store.gapMetrics({
      now,
      resolvedSince: new Date(
        Date.parse(now) - 30 * 86_400_000,
      ).toISOString(),
    });
    expect(m.overdueCount).toBe(3);
    expect(m.unassignedCount).toBe(1);
    expect(m.breachesTotal).toBe(2);
    expect(m.resolvedInWindow).toBe(2);
    expect(m.timeToClearAvgSec).toBeCloseTo(150, 3);
    expect(m.timeToClearMedianSec).toBeCloseTo(150, 3);

    const res = await app.request("/admin/api/knowledge/gaps/metrics", {
      headers: { "x-admin-key": admin.key },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windowDays).toBe(30);
    expect(body.overdueCount).toBe(3);
    expect(body.unassignedCount).toBe(1);
    expect(body.breachesTotal).toBe(2);
    expect(body.resolvedInWindow).toBe(2);
    expect(body.timeToClearAvgSec).toBeCloseTo(150, 3);
    expect(body.timeToClearMedianSec).toBeCloseTo(150, 3);
  });

  it("empty queue → zeros + nulls, never NaN/500", async () => {
    const { app, admin } = await mkApp();
    const res = await app.request("/admin/api/knowledge/gaps/metrics", {
      headers: { "x-admin-key": admin.key },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      windowDays: 30,
      overdueCount: 0,
      unassignedCount: 0,
      breachesTotal: 0,
      resolvedInWindow: 0,
      timeToClearAvgSec: null,
      timeToClearMedianSec: null,
    });
  });

  it("?days= windows the clear-time set; clamped to sane bounds", async () => {
    const { app, store, admin } = await mkApp();
    await mkResolved(store, 100);

    const get = async (q: string) => {
      const res = await app.request(
        `/admin/api/knowledge/gaps/metrics?${q}`,
        { headers: { "x-admin-key": admin.key } },
      );
      expect(res.status).toBe(200);
      return res.json();
    };
    // Fresh resolve is inside every window; garbage input defaults.
    expect((await get("days=7")).windowDays).toBe(7);
    expect((await get("days=7")).resolvedInWindow).toBe(1);
    expect((await get("days=0")).windowDays).toBe(30);
    expect((await get("days=-5")).windowDays).toBe(30);
    expect((await get("days=9999")).windowDays).toBe(365);
    expect((await get("days=abc")).windowDays).toBe(30);
    // A past-dated window excludes the fresh resolve.
    expect((await get("days=1")).resolvedInWindow).toBe(1);
  });

  it("admin-only — no key, no digest", async () => {
    const { app } = await mkApp();
    const res = await app.request("/admin/api/knowledge/gaps/metrics");
    expect([401, 403]).toContain(res.status);
  });

  it("RESOLVED drops out of overdue even with a stale past dueAt", async () => {
    const store = createMemoryKnowledgeStores();
    const g = await mkOverdue(store);
    await store.transitionGap(g.id, {
      from: "OPEN",
      to: "TRIAGED",
      resolvedAt: null,
    });
    await store.transitionGap(g.id, {
      from: "TRIAGED",
      to: "RESOLVED",
      resolvedAt: new Date().toISOString(),
    });
    const now = new Date().toISOString();
    const m = await store.gapMetrics({
      now,
      resolvedSince: new Date(
        Date.parse(now) - 30 * 86_400_000,
      ).toISOString(),
    });
    expect(m.overdueCount).toBe(0);
    expect(m.resolvedInWindow).toBe(1);
  });
});

/**
 * PG backend — the real aggregate query through the installed
 * artifact (count(*)/percentile_cont live there). Gated on
 * KNOWLEDGE_PG_URL like the sweeper suite. Global counts assert
 * as DELTAS (shared dev DB); the clear-time window starts NOW so
 * resolved history is excluded.
 */
const PG_URL = process.env["KNOWLEDGE_PG_URL"];
describe.skipIf(!PG_URL)("gap metrics — PG backend", () => {
  let database: Database | undefined;
  afterAll(async () => {
    await database?.close();
  });

  it("deltas + exact clear time through DbKnowledgeStore", async () => {
    database = createDatabase({ url: PG_URL, enabled: true });
    const k = database.knowledge;
    if (!k) throw new Error("knowledge repos missing");
    const store = new DbKnowledgeStore(k.core, k.taxonomy);
    const FAR = "2999-01-01T00:00:00.000Z";
    const since = new Date().toISOString();

    const before = await store.gapMetrics({
      now: FAR,
      resolvedSince: since,
    });
    expect(before.resolvedInWindow).toBe(0);

    await mkOverdue(store);
    await mkOverdue(store);
    const od = await mkOverdue(store);
    await mkGap(store);
    await mkResolved(store, 100);
    await store.recordOverdue({
      id: `kgo_${gapOverdueId()}`,
      gapId: od.id,
      dueAt: PAST,
    });

    const after = await store.gapMetrics({
      now: FAR,
      resolvedSince: since,
    });
    expect(after.overdueCount - before.overdueCount).toBe(3);
    expect(after.unassignedCount - before.unassignedCount).toBe(1);
    expect(after.breachesTotal - before.breachesTotal).toBe(1);
    expect(after.resolvedInWindow).toBe(1);
    expect(after.timeToClearAvgSec).toBeCloseTo(100, 3);
    expect(after.timeToClearMedianSec).toBeCloseTo(100, 3);
  });
});
