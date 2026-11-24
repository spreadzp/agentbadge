import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  demandRoutes,
  resetDemandRateLimits,
} from "../../src/server/routes/api/demand";
import { createAdminDemandRoutes } from "../../src/server/routes/admin-demand-api";
import {
  pickDemandStore,
  resetDemandMemoryStoreForTests,
} from "../../src/server/lib/demand/db-stores";
import { recordInteractionDemand } from "../../src/server/lib/demand/seams";
import type { BacklogTaskWriter } from "../../src/server/lib/demand/backlog-export";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * SLICE-231-9: end-to-end over the real HTTP surfaces on the memory
 * fallback (DATABASE_ENABLED off ⇒ pickDemandStore({}) → "memory"):
 *
 *   POST /api/demand/request (identified + anonymous actors)
 *     → signals/clusters (+ burst-dedupe, §13.2)
 *     → operator triage → opportunity lifecycle
 *     → «→ Backlog task» export (stub writer)
 *     → §17.4/§17.1 metrics
 *
 * Identified actors ride a test shim that sets the context keys the
 * real upstream middlewares (agentKeyAuth / did-auth) would set —
 * resolveActor itself performs no verification.
 */

const captured = { cards: [] as { description: string }[] };
const writer: BacklogTaskWriter = {
  write: async (card) => {
    captured.cards.push(card);
    return {
      taskId: `MYPROJ-${7000 + captured.cards.length}`,
      filePath: "/stub",
      rollback: async () => {},
    };
  },
};

const mkApp = () => {
  const store = pickDemandStore({}); // shared memory singleton
  const opStore = createMemoryOperatorStore();
  const app = new Hono();
  // Test shim — emulate upstream identity resolution (agentKeyAuth /
  // did-auth set these context keys on the real app).
  app.use("/api/demand/*", async (c, next) => {
    const agent = c.req.header("x-test-agent");
    const did = c.req.header("x-test-did");
    const set = c.set.bind(c) as (k: string, v: string) => void;
    if (did) set("verifiedDid", did);
    else if (agent) set("agentId", agent);
    await next();
  });
  app.route("/", demandRoutes);
  app.route(
    "/",
    createAdminDemandRoutes({
      store,
      operatorStore: opStore,
      backlogWriter: () => writer,
    }),
  );
  return { app, store, opStore };
};

const REQ = "/api/demand/request";
const QUERY = "escrow my agent payout";

const post = (app: Hono, h: Record<string, string> = {}) =>
  app.request(REQ, {
    method: "POST",
    headers: { "content-type": "application/json", ...h },
    body: JSON.stringify({ capability_query: QUERY }),
  });

const admin = (
  app: Hono,
  key: string,
  path: string,
  opts: { method?: string; body?: unknown; idem?: string } = {},
) =>
  app.request(path, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-admin-key": key,
      ...(opts.idem ? { "idempotency-key": opts.idem } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

describe("SLICE-231-9: e2e request→signal→cluster→opportunity→backlog→metrics", () => {
  beforeEach(() => {
    resetDemandMemoryStoreForTests();
    resetDemandRateLimits();
    captured.cards.length = 0;
    // ANON buckets come from the truncated client IP — proxy headers
    // let the test mint distinct buckets per XFF value.
    process.env.TRUST_PROXY_HEADERS = "true";
  });
  afterEach(() => {
    delete process.env.TRUST_PROXY_HEADERS;
  });

  it("memory fallback carries the whole pipeline (no DB)", () => {
    expect(pickDemandStore({}).backend).toBe("memory");
  });

  it("full flow: multi-actor demand → level promotion → operator chain → metrics", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);

    // ── 10 distinct actors, same need: 3 API_KEY + 7 ANON IPs.
    for (const agent of ["agent_a", "agent_b", "agent_c"]) {
      const r = await post(app, { "x-test-agent": agent });
      expect(r.status).toBe(202);
    }
    for (let i = 1; i <= 7; i++) {
      const r = await post(app, { "x-forwarded-for": `10.9.8.${i}` });
      expect(r.status).toBe(202);
    }
    // Burst dup from agent_a — same actor+text in-window → related row.
    const dup = await post(app, { "x-test-agent": "agent_a" });
    expect(dup.status).toBe(202);
    const dupJson = await dup.json();
    expect(dupJson.count).toBe(11); // registrations incl. repeats

    // Second, quieter need from one actor → second cluster.
    const other = await app.request(REQ, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-agent": "agent_a" },
      body: JSON.stringify({ capability_query: "niche xyzzy feature" }),
    });
    expect(other.status).toBe(202);

    // A seam-source signal carrying a sessionId (§17.1 sessions split).
    const seam = await recordInteractionDemand(store, {
      signal: "interactive ask",
      requestId: "ireq_e2e_1",
      sessionId: "sess-77",
      actor: { resolution: "DID", actorRef: "did:hcs:1:2" },
    });
    expect(seam.ok).toBe(true);

    // ── Cluster: 10 canonical, 10 unique actors → PURCHASE_INTENT.
    const clusters = await admin(app, key, "/api/admin/demand/clusters?sort=count");
    const cl = (await clusters.json()).items as {
      id: string; count: number; uniqueActors: number; level: string;
    }[];
    expect(cl.length).toBe(3); // escrow + niche + seam cluster
    const hot = cl[0]!;
    expect(hot.count).toBe(10);
    expect(hot.uniqueActors).toBe(10); // actor repeat did NOT inflate (§13.2)
    expect(hot.level).toBe("PURCHASE_INTENT"); // 10-actor floor promotion

    // ── Operator chain: triage → opportunity → accept → backlog.
    const triage = await admin(app, key, `/api/admin/demand/clusters/${hot.id}/triage`, {
      method: "POST", body: { to: "TRIAGED" }, idem: "e2e-triage-1",
    });
    expect(triage.status).toBe(200);

    const create = await admin(app, key, `/api/admin/demand/clusters/${hot.id}/opportunity`, {
      method: "POST", body: { title: "Escrow payouts" }, idem: "e2e-opp-1",
    });
    expect(create.status).toBe(201);
    const opp = (await create.json()).opportunity as { id: string };
    const snapshot = await store.getOpportunity(opp.id);
    expect(snapshot?.metricsSnapshot?.count).toBe(10);

    for (const [to, idem] of [["EVALUATING", "e2e-tr-1"], ["ACCEPTED", "e2e-tr-2"]] as const) {
      const r = await admin(app, key, `/api/admin/demand/opportunities/${opp.id}/transition`, {
        method: "POST", body: { to }, idem,
      });
      expect(r.status).toBe(200);
    }
    const link = await admin(app, key, `/api/admin/demand/opportunities/${opp.id}/backlog`, {
      method: "POST", idem: "e2e-link-1",
    });
    expect(link.status).toBe(200);
    const linkJson = await link.json();
    expect(linkJson.taskId).toBe("MYPROJ-7001");
    expect(linkJson.opportunity.status).toBe("LINKED");
    expect(linkJson.opportunity.backlogTaskId).toBe("MYPROJ-7001");
    // Card built from the frozen snapshot — demand line present.
    expect(captured.cards[0]!.description).toContain("10 canonical requests");

    // ── §17.4/§17.1 metrics.
    const metrics = await admin(app, key, "/api/admin/demand/metrics");
    expect(metrics.status).toBe(200);
    const m = await metrics.json();
    expect(m.requests).toBe(13); // 10 canonical + 1 dup + 1 niche + 1 seam
    expect(m.canonicalSignals).toBe(12);
    expect(m.repeatDemand).toBe(1);
    // identified: 3 api_key canon + 1 dup + 1 niche + 1 DID seam = 6;
    // anonymous: 7.
    expect(m.actors.identified).toBe(6);
    expect(m.actors.anonymous).toBe(7);
    expect(m.actors.sessions).toBe(1);
    expect(m.clusters.byStatus.TRIAGED).toBe(1);
    expect(m.topCapabilities[0].count).toBe(10);
    expect(m.highIntent.purchaseIntent).toBe(1);
    expect(m.highIntent.verifiedDemand).toBe(0); // VERIFIED never by rules
    expect(m.demandToFeatures.total).toBe(1);
    expect(m.demandToFeatures.linkedToBacklog).toBe(1);
    expect(m.demandToFeatures.shipped).toBe(0);
  });
});
