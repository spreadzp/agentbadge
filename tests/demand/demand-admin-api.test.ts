import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAdminDemandRoutes } from "../../src/server/routes/admin-demand-api";
import { createMemoryDemandStores } from "../../src/server/lib/demand/db-stores";
import { ingestDemand } from "../../src/server/lib/demand/pipeline";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * SLICE-231-5: admin JSON API /api/admin/demand/* over the memory
 * backend. Covers auth gates (401/403), cluster list/detail, signal
 * filters, operator retag (re-attach + recount + event), cluster
 * triage (legal + refused transitions) and the §17.4 metrics digest.
 */

const mkApp = () => {
  const store = createMemoryDemandStores();
  const opStore = createMemoryOperatorStore();
  const app = new Hono();
  app.route("/", createAdminDemandRoutes({ store, operatorStore: opStore }));
  return { app, store, opStore };
};

const admin = (
  app: Hono,
  key: string | null,
  path: string,
  opts: { method?: string; body?: unknown; idem?: string } = {},
) =>
  app.request(path, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-admin-key": key } : {}),
      ...(opts.idem ? { "idempotency-key": opts.idem } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

const seedDemand = async (store: ReturnType<typeof createMemoryDemandStores>) => {
  const a = await ingestDemand(
    store,
    {
      text: "can you escrow my payout",
      source: "DEMAND_API",
      declaredLevel: "INTENT",
      sessionId: "s1",
    },
    { resolution: "API_KEY", actorRef: "agent:agb_1" },
  );
  await ingestDemand(
    store,
    {
      text: "can you escrow my payout",
      source: "DEMAND_API",
      declaredLevel: "INTENT",
      sessionId: "s2",
    },
    { resolution: "API_KEY", actorRef: "agent:agb_2" },
  );
  const b = await ingestDemand(
    store,
    {
      text: "totally novel xyzzy ask",
      source: "FEEDBACK",
      declaredLevel: "INTEREST",
    },
    { resolution: "ANON", actorRef: "anon:ip:1" },
  );
  if (!a.ok || !b.ok) throw new Error("seed ingest failed");
  return { a, b };
};

describe("auth gates", () => {
  it("401 without credential, 403 for read-only on mutations", async () => {
    const { app, opStore } = mkApp();
    expect((await app.request("/api/admin/demand/clusters")).status).toBe(401);
    const { key: ro } = await seedOperator(opStore, "RO", ["read"]);
    const { key: wf } = await seedOperator(opStore, "WF", ["read", "workflow"]);
    expect((await admin(app, ro, "/api/admin/demand/clusters")).status).toBe(200);
    const denied = await admin(app, ro, "/api/admin/demand/clusters/x/triage", {
      method: "POST",
      body: { to: "TRIAGED" },
      idem: "idem-triage-1",
    });
    expect(denied.status).toBe(403);
    const missing = await admin(app, wf, "/api/admin/demand/clusters/x/triage", {
      method: "POST",
      body: { to: "TRIAGED" },
      idem: "idem-triage-2",
    });
    expect(missing.status).toBe(404);
  });
});

describe("clusters + signals reads", () => {
  it("lists clusters sorted by count with filters", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    await seedDemand(store);
    const r = await admin(app, key, "/api/admin/demand/clusters?sort=count");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.count).toBe(2);
    expect(j.items[0].count).toBe(2);
    expect(j.items[0].uniqueActors).toBe(2);
    expect(j.items[0].level).toBe("INTENT"); // max(INTENT, floor NEED)
    const filtered = await admin(
      app, key, "/api/admin/demand/clusters?level=INTENT",
    );
    expect((await filtered.json()).count).toBe(1);
    expect((await admin(app, key, "/api/admin/demand/clusters?status=BOGUS")).status).toBe(400);
  });

  it("cluster detail returns signals + events; unknown → 404", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const { a } = await seedDemand(store);
    const r = await admin(app, key, `/api/admin/demand/clusters/${a.cluster.id}`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.cluster.id).toBe(a.cluster.id);
    expect(j.signals.map((s: { id: string }) => s.id)).toContain(a.signal.id);
    expect(j.signals[0].actorRef).toBeTruthy(); // internal field — admin only
    expect(Array.isArray(j.events)).toBe(true);
    expect(
      (await admin(app, key, "/api/admin/demand/clusters/dc_none")).status,
    ).toBe(404);
  });

  it("lists signals with source/level/canonicalOnly filters", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const { a } = await seedDemand(store);
    // burst-dup from the same actor+text within 24h → related row
    await ingestDemand(
      store,
      {
        text: "can you escrow my payout",
        source: "DEMAND_API",
        declaredLevel: "INTENT",
        sessionId: "s1",
      },
      { resolution: "API_KEY", actorRef: "agent:agb_1" },
    );
    const r = await admin(app, key, "/api/admin/demand/signals?source=DEMAND_API");
    const j = await r.json();
    expect(j.count).toBe(3);
    const canon = await admin(
      app, key, "/api/admin/demand/signals?canonicalOnly=true",
    );
    expect((await canon.json()).count).toBe(3);
    const byCluster = await admin(
      app, key, `/api/admin/demand/signals?clusterId=${a.cluster.id}`,
    );
    expect((await byCluster.json()).count).toBe(3);
    expect((await admin(app, key, "/api/admin/demand/signals?source=NOPE")).status).toBe(400);
  });
});

describe("retag + triage mutations", () => {
  it("retag re-attaches canonical to derived cluster, emits events", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const { b } = await seedDemand(store);
    const r = await admin(app, key, `/api/admin/demand/signals/${b.signal.id}/retag`, {
      method: "POST",
      body: { category: "payments", feature: "refund" },
      idem: "idem-retag-1",
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.signal.category).toBe("payments");
    expect(j.signal.feature).toBe("refund");
    expect(j.cluster.clusterKey).toBe("dict:payments|refund");
    const moved = await store.getSignal(b.signal.id);
    expect(moved?.clusterId).toBe(j.cluster.id);
    const events = await store.listEvents("signal", b.signal.id);
    expect(events.map((e) => e.kind)).toContain("demand.signal.retagged");
  });

  it("linked (related) rows refuse retag → 409", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const { a } = await seedDemand(store);
    const dup = await ingestDemand(
      store,
      {
        text: "can you escrow my payout",
        source: "DEMAND_API",
        declaredLevel: "INTENT",
        sessionId: "s1",
      },
      { resolution: "API_KEY", actorRef: "agent:agb_1" },
    );
    if (!dup.ok) throw new Error("dup ingest failed");
    expect(dup.signal.relatedSignalId).toBe(a.ok ? a.signal.id : "unreachable");
    const r = await admin(app, key, `/api/admin/demand/signals/${dup.signal.id}/retag`, {
      method: "POST",
      body: { category: "x" },
      idem: "idem-retag-2",
    });
    expect(r.status).toBe(409);
  });

  it("triage drives OPEN→TRIAGED and refuses illegal hops → 409", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const { a } = await seedDemand(store);
    const ok = await admin(app, key, `/api/admin/demand/clusters/${a.cluster.id}/triage`, {
      method: "POST",
      body: { to: "TRIAGED", reason: "looks real" },
      idem: "idem-triage-a",
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).cluster.status).toBe("TRIAGED");
    const illegal = await admin(app, key, `/api/admin/demand/clusters/${a.cluster.id}/triage`, {
      method: "POST",
      body: { to: "LINKED" },
      idem: "idem-triage-b",
    });
    // TRIAGED→LINKED is actually legal — DISMISSED→LINKED is not; use a
    // real illegal hop: TRIAGED stays, DISMISSED→LINKED via two steps.
    expect(illegal.status).toBe(200); // legal per table
    const dismissed = await admin(app, key, `/api/admin/demand/clusters/${a.cluster.id}/triage`, {
      method: "POST",
      body: { to: "DISMISSED" },
      idem: "idem-triage-c",
    });
    expect(dismissed.status).toBe(409); // LINKED is terminal
  });

  it("mutations require Idempotency-Key → 400", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const { b } = await seedDemand(store);
    const r = await admin(app, key, `/api/admin/demand/signals/${b.signal.id}/retag`, {
      method: "POST",
      body: { category: "x" },
    });
    expect(r.status).toBe(400);
  });
});

describe("opportunity lifecycle (231-7)", () => {
  const mkOpp = async (
    app: Hono,
    key: string,
    store: ReturnType<typeof createMemoryDemandStores>,
  ) => {
    const a = await ingestDemand(
      store,
      { text: "can you escrow my payout", source: "DEMAND_API", declaredLevel: "INTENT" },
      { resolution: "API_KEY", actorRef: "agent:agb_1" },
    );
    if (!a.ok) throw new Error("seed failed");
    const r = await admin(app, key, `/api/admin/demand/clusters/${a.cluster.id}/opportunity`, {
      method: "POST", body: {}, idem: `idem-opp-${a.cluster.id}`,
    });
    expect(r.status).toBe(201);
    return (await r.json()).opportunity as { id: string; status: string };
  };

  it("create → snapshot frozen; transition validates lifecycle", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const opp = await mkOpp(app, key, store);
    expect(opp.status).toBe("PROPOSED");
    const full = await store.getOpportunity(opp.id);
    expect(full?.metricsSnapshot?.count).toBe(1);
    // PROPOSED→SHIPPED illegal (no direct hop)
    const bad = await admin(app, key, `/api/admin/demand/opportunities/${opp.id}/transition`, {
      method: "POST", body: { to: "SHIPPED" }, idem: "idem-tr-bad",
    });
    expect(bad.status).toBe(409);
    // PROPOSED→EVALUATING→ACCEPTED legal
    for (const [to, idem] of [["EVALUATING", "idem-tr-ok1"], ["ACCEPTED", "idem-tr-ok2"]] as const) {
      const r = await admin(app, key, `/api/admin/demand/opportunities/${opp.id}/transition`, {
        method: "POST", body: { to }, idem,
      });
      expect(r.status).toBe(200);
    }
    // LINKED refused at the ops layer — the link gesture owns it
    const linked = await admin(app, key, `/api/admin/demand/opportunities/${opp.id}/transition`, {
      method: "POST", body: { to: "LINKED" }, idem: "idem-tr-ok3",
    });
    expect(linked.status).toBe(409);
    const events = await store.listEvents("opportunity", opp.id);
    expect(events.filter((e) => e.kind === "demand.opportunity.updated").length).toBe(2);
  });

  it("edit updates fields without a status move; empty patch → 400", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const opp = await mkOpp(app, key, store);
    const r = await admin(app, key, `/api/admin/demand/opportunities/${opp.id}/edit`, {
      method: "POST",
      body: { title: "Escrow payouts", hypothesis: "agents want escrow", expectedValue: "high" },
      idem: "idem-edit-1",
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.opportunity.title).toBe("Escrow payouts");
    expect(j.opportunity.status).toBe("PROPOSED"); // unchanged
    const empty = await admin(app, key, `/api/admin/demand/opportunities/${opp.id}/edit`, {
      method: "POST", body: {}, idem: "idem-edit-2",
    });
    expect(empty.status).toBe(400);
    const events = await store.listEvents("opportunity", opp.id);
    expect(events.map((e) => e.kind)).toContain("demand.opportunity.updated");
  });

  it("GET /opportunities lists with status filter", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    await mkOpp(app, key, store);
    const r = await admin(app, key, "/api/admin/demand/opportunities?status=PROPOSED");
    expect(r.status).toBe(200);
    expect((await r.json()).count).toBe(1);
    const closed = await admin(app, key, "/api/admin/demand/opportunities?status=SHIPPED");
    expect((await closed.json()).count).toBe(0);
  });
});

describe("metrics", () => {
  it("returns the §17.4 digest", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    await seedDemand(store);
    const r = await admin(app, key, "/api/admin/demand/metrics");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.requests).toBe(3);
    expect(j.canonicalSignals).toBe(3);
    expect(j.actors.identified).toBe(2);
    expect(j.actors.anonymous).toBe(1);
    expect(j.actors.sessions).toBe(2);
    expect(j.clusters.total).toBe(2);
    expect(j.clusters.byStatus.OPEN).toBe(2);
    expect(j.topCapabilities[0].count).toBe(2);
    expect(j.demandToFeatures.total).toBe(0);
  });
});
