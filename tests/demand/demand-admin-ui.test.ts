import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAdminDemandUi } from "../../src/server/routes/admin-demand-ui";
import { createMemoryDemandStores } from "../../src/server/lib/demand/db-stores";
import { ingestDemand } from "../../src/server/lib/demand/pipeline";
import { mintFormToken } from "../../src/server/lib/knowledge/form-tokens";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * SLICE-231-6: operator SSR console /admin/demand — three tabs
 * (clusters | signals | opportunities), inline triage + re-tag +
 * «→ Opportunity» gestures through the shared operator-ops.
 */

const mkApp = () => {
  const store = createMemoryDemandStores();
  const opStore = createMemoryOperatorStore();
  const app = new Hono();
  app.route("/", createAdminDemandUi(store, opStore));
  return { app, store, opStore };
};

const get = (app: Hono, key: string | null, path: string) =>
  app.request(path, {
    headers: key ? { "x-admin-key": key } : {},
  });

const post = (
  app: Hono,
  key: string,
  path: string,
  fields: Record<string, string>,
) =>
  app.request(path, {
    method: "POST",
    headers: {
      "x-admin-key": key,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ formToken: mintFormToken(), ...fields }).toString(),
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
  if (!a.ok) throw new Error("seed failed");
  return a;
};

describe("auth + tabs render", () => {
  it("401 without credential; all three tabs render with data", async () => {
    const { app, store, opStore } = mkApp();
    expect((await get(app, null, "/admin/demand")).status).toBe(401);
    const { key } = await seedOperator(opStore);
    await seedDemand(store);

    const clusters = await get(app, key, "/admin/demand");
    expect(clusters.status).toBe(200);
    const html = await clusters.text();
    expect(html).toContain("Top by count");
    expect(html).toContain("Top by unique actors");
    expect(html).toContain("dict:payments|escrow");

    const signals = await get(app, key, "/admin/demand/signals");
    expect(signals.status).toBe(200);
    expect(await signals.text()).toContain("DEMAND_API");

    const opps = await get(app, key, "/admin/demand/opportunities");
    expect(opps.status).toBe(200);
    expect(await opps.text()).toContain("Opportunities");
  });
});

describe("UI mutations (PRG)", () => {
  it("triage form transitions cluster → 303 + status", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore, "Op", ["read", "workflow"]);
    const a = await seedDemand(store);
    const r = await post(
      app, key, `/admin/demand/clusters/${a.cluster.id}/triage`, { to: "TRIAGED" },
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("ok=transitioned_TRIAGED");
    expect((await store.getCluster(a.cluster.id))?.status).toBe("TRIAGED");
  });

  it("re-tag form rewrites category/feature → 303 + dict cluster", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore, "Op", ["read", "workflow"]);
    const a = await seedDemand(store);
    const r = await post(
      app, key, `/admin/demand/signals/${a.signal.id}/retag`,
      { category: "payments", feature: "refunds" },
    );
    expect(r.status).toBe(303);
    const s = await store.getSignal(a.signal.id);
    expect(s?.category).toBe("payments");
    expect(s?.feature).toBe("refunds");
  });

  it("«→ Opportunity» drafts a PROPOSED opp with metrics snapshot", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore, "Op", ["read", "workflow"]);
    const a = await seedDemand(store);
    const r = await post(
      app, key, `/admin/demand/clusters/${a.cluster.id}/opportunity`, {},
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("/admin/demand/opportunities");
    const opps = await store.listOpportunities({});
    expect(opps.length).toBe(1);
    expect(opps[0].status).toBe("PROPOSED");
    expect(opps[0].clusterId).toBe(a.cluster.id);
    expect(opps[0].metricsSnapshot?.count).toBe(a.cluster.count);
    const events = await store.listEvents("opportunity", opps[0].id);
    expect(events.map((e) => e.kind)).toContain("demand.opportunity.created");
  });

  it("opportunity transition + edit forms drive the lifecycle (231-7)", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore, "Op", ["read", "workflow"]);
    const a = await seedDemand(store);
    await post(app, key, `/admin/demand/clusters/${a.cluster.id}/opportunity`, {});
    const [opp] = await store.listOpportunities({});
    const tr = await post(
      app, key, `/admin/demand/opportunities/${opp.id}/transition`, { to: "EVALUATING" },
    );
    expect(tr.status).toBe(303);
    expect((await store.getOpportunity(opp.id))?.status).toBe("EVALUATING");
    const ed = await post(
      app, key, `/admin/demand/opportunities/${opp.id}/edit`,
      { title: "Escrow payouts", hypothesis: "agents want it", expectedValue: "high" },
    );
    expect(ed.status).toBe(303);
    const fresh = await store.getOpportunity(opp.id);
    expect(fresh?.title).toBe("Escrow payouts");
    expect(fresh?.status).toBe("EVALUATING");
  });

  it("missing formToken → flash err, no write", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore, "Op", ["read", "workflow"]);
    const a = await seedDemand(store);
    const r = await app.request(
      `/admin/demand/clusters/${a.cluster.id}/triage`,
      {
        method: "POST",
        headers: {
          "x-admin-key": key,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ to: "TRIAGED" }).toString(),
      },
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("err=form_expired_or_duplicate");
    expect((await store.getCluster(a.cluster.id))?.status).toBe("OPEN");
  });

  it("read-only credential → 403 on POST", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore, "RO", ["read"]);
    const a = await seedDemand(store);
    const r = await post(
      app, key, `/admin/demand/clusters/${a.cluster.id}/triage`, { to: "TRIAGED" },
    );
    expect(r.status).toBe(403);
  });
});
