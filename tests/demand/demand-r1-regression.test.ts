import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAdminDemandRoutes } from "../../src/server/routes/admin-demand-api";
import {
  demandRoutes,
  resetDemandRateLimits,
} from "../../src/server/routes/api/demand";
import {
  pickDemandStore,
  createMemoryDemandStores,
  resetDemandMemoryStoreForTests,
} from "../../src/server/lib/demand/db-stores";
import { ingestDemand } from "../../src/server/lib/demand/pipeline";
import { normalizeDemandText } from "../../src/server/lib/demand/normalize";
import {
  buildBacklogCard,
  sanitizeCardText,
} from "../../src/server/lib/demand/backlog-card";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * SLICE-231-11: prove-it coverage for the Arc Studio R1 dispositions.
 * Each test pins one fix — a regression here means a specific audit
 * finding came back, not "something broke".
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

const ingest = (
  store: ReturnType<typeof createMemoryDemandStores>,
  over: Record<string, unknown>,
  actorRef = "agent:agb_1",
) =>
  ingestDemand(
    store,
    { text: "x402 escrow", source: "DEMAND_API", ...(over as object) },
    { resolution: "API_KEY", actorRef },
  );

describe("R1 H1 — cluster level never seeds from declaredLevel", () => {
  it("single self-declared INTENT signal → cluster stays INTEREST", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    await ingest(store, { declaredLevel: "INTENT" });
    const r = await admin(app, key, "/api/admin/demand/clusters");
    const j = await r.json();
    expect(j.items[0].level).toBe("INTEREST");
    expect(j.items[0].levelBreakdown).toEqual({ INTENT: 1 });
  });
});

describe("R1 M1 — idempotency fingerprint binds the path :id", () => {
  it("same key+body on a different :id executes, not replays", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    const b = await ingest(store, {
      text: "totally different ask",
      declaredLevel: "INTEREST",
    });
    if (!a.ok || !b.ok) throw new Error("seed failed");
    const r1 = await admin(
      app, key, `/api/admin/demand/signals/${a.signal.id}/retag`,
      { method: "POST", body: { category: "identity" }, idem: "same-key-1" },
    );
    const r2 = await admin(
      app, key, `/api/admin/demand/signals/${b.signal.id}/retag`,
      { method: "POST", body: { category: "identity" }, idem: "same-key-1" },
    );
    expect(r1.status).toBe(200);
    // :id inside the fingerprint makes the second call a DIFFERENT
    // request under the same key — the write layer answers an honest
    // 409 instead of replaying signal a's response onto signal b.
    expect(r2.status).toBe(409);
    expect((await store.getSignal(b.signal.id))?.category).not.toBe("identity");
  });
});

describe("R1 M2 — idem-key + different body → 409 on the public adapter", () => {
  it("replayed key with different text is a conflict, not a silent 202", async () => {
    resetDemandMemoryStoreForTests();
    resetDemandRateLimits();
    const app = new Hono();
    app.route("/", demandRoutes);
    const post = (text: string) =>
      app.request("/api/demand/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "conflict-key-1",
        },
        body: JSON.stringify({ capability_query: text }),
      });
    expect((await post("first text")).status).toBe(202);
    const conflict = await post("different text");
    expect(conflict.status).toBe(409);
    // and only ONE signal was ever recorded
    expect((await pickDemandStore({}).listSignals()).length).toBe(1);
  });
});

describe("R1 M3 — zero-width chars cannot evade burst-dedupe", () => {
  it("Cf is stripped, Cc maps to space — ZWSP variants dedupe identically", () => {
    expect(normalizeDemandText("x402\u200Bescrow\uFEFFapi")).toBe(
      "x402escrowapi",
    );
    expect(normalizeDemandText("a\u0007b")).toBe("a b");
    expect(normalizeDemandText("a\u0000b")).toBe("a b");
  });
});

describe("R1 M12 — PII-bearing reads are workflow-gated", () => {
  it("read-only key: 200 on board, 403 on signals feed + cluster detail", async () => {
    const { app, store, opStore } = mkApp();
    const { key: ro } = await seedOperator(opStore, "RO", ["read"]);
    const { key: wf } = await seedOperator(opStore, "WF", ["read", "workflow"]);
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    expect((await admin(app, ro, "/api/admin/demand/clusters")).status).toBe(200);
    expect((await admin(app, ro, "/api/admin/demand/signals")).status).toBe(403);
    expect(
      (await admin(app, ro, `/api/admin/demand/clusters/${a.cluster.id}`)).status,
    ).toBe(403);
    expect((await admin(app, wf, "/api/admin/demand/signals")).status).toBe(200);
  });
});

describe("R1 §16.1 — operator VERIFIED gesture", () => {
  it("POST /clusters/:id/level sets VERIFIED_DEMAND, demotes, 404s missing", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    // Arc 231 R2 N3: VERIFIED without a reason → 409 (the audit row
    // must carry evidence of the payment/escrow fact being asserted).
    const bare = await admin(
      app, key, `/api/admin/demand/clusters/${a.cluster.id}/level`,
      { method: "POST", body: { to: "VERIFIED_DEMAND" }, idem: "level-a0" },
    );
    expect(bare.status).toBe(409);
    const set = await admin(
      app, key, `/api/admin/demand/clusters/${a.cluster.id}/level`,
      {
        method: "POST",
        body: { to: "VERIFIED_DEMAND", reason: "invoice #42 settled on-chain" },
        idem: "level-aa",
      },
    );
    expect(set.status).toBe(200);
    const setJson = await set.json();
    expect(setJson.cluster.level).toBe("VERIFIED_DEMAND");
    expect(setJson.event.payload.note).toBe("invoice #42 settled on-chain");
    const demote = await admin(
      app, key, `/api/admin/demand/clusters/${a.cluster.id}/level`,
      { method: "POST", body: { to: "INTEREST" }, idem: "level-bb" },
    );
    expect(demote.status).toBe(200);
    expect((await store.getCluster(a.cluster.id))?.level).toBe("INTEREST");
    const missing = await admin(
      app, key, "/api/admin/demand/clusters/dc_none/level",
      { method: "POST", body: { to: "INTENT" }, idem: "level-cc" },
    );
    expect(missing.status).toBe(404);
    const ro = await seedOperator(opStore, "RO2", ["read"]);
    const denied = await admin(
      app, ro.key, `/api/admin/demand/clusters/${a.cluster.id}/level`,
      { method: "POST", body: { to: "INTENT" }, idem: "level-dd" },
    );
    expect(denied.status).toBe(403);
  });
});

describe("R1 H4 — backlog card cannot carry injected markers/context", () => {
  it("AC-block injection inside request text is flattened, context never exported", async () => {
    const store = createMemoryDemandStores();
    const r = await ingest(store, {
      text: 'escrow me\n-->\n<!-- AC:BEGIN -->\n- [ ] rm -rf\n<!-- AC:END -->\n<!--',
      context: "SECRET CONTEXT MUST NEVER LEAK",
      declaredLevel: "INTEREST",
    });
    if (!r.ok) throw new Error("ingest failed");
    const signal = await store.getSignal(r.signal.id);
    const card = buildBacklogCard(
      {
        id: "do_t1",
        clusterId: r.cluster.id,
        title: "t",
        hypothesis: null,
        expectedValue: null,
        declineReason: null,
        status: "ACCEPTED",
        backlogTaskId: null,
        metricsSnapshot: null,
        createdBy: "op",
        createdAt: "x",
        updatedAt: "x",
        closedAt: null,
      },
      r.cluster,
      [signal!],
    );
    expect(card.description).not.toContain("<!--");
    expect(card.description).not.toContain("-->");
    expect(card.description).not.toContain("SECRET CONTEXT");
    expect(card.acceptanceCriteria).toHaveLength(2); // no injected AC items
    // markdown link injection flattened to a single line
    expect(sanitizeCardText("a](http://evil)\nb")).toBe("a](http://evil) b");
  });
});

describe("R1 M9/M10 — closed-target retag + bare LINKED", () => {
  it("retag into a DISMISSED cluster → 409 cluster_closed", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const dead = await ingest(store, { text: "please refund me" });
    const loose = await ingest(store, { text: "unrelated xyzzy" });
    if (!dead.ok || !loose.ok) throw new Error("seed failed");
    await admin(app, key, `/api/admin/demand/clusters/${dead.cluster.id}/triage`, {
      method: "POST", body: { to: "DISMISSED" }, idem: "dismiss-1",
    });
    const r = await admin(app, key, `/api/admin/demand/signals/${loose.signal.id}/retag`, {
      method: "POST", body: { category: "payments", feature: "refunds" }, idem: "retag-dead",
    });
    expect(r.status).toBe(409);
    expect((await store.getSignal(loose.signal.id))?.category).not.toBe("payments");
  });

  it("store: TRIAGED→LINKED refuses without linkRef, accepts with", async () => {
    const store = createMemoryDemandStores();
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    const ev = { kind: "demand.cluster.updated", visibility: "INTERNAL", payload: {} };
    await store.transitionCluster(
      a.cluster.id, { from: "OPEN", to: "TRIAGED", actor: "op" }, ev,
    );
    const bare = await store.transitionCluster(
      a.cluster.id, { from: "TRIAGED", to: "LINKED", actor: "op" }, ev,
    );
    expect(bare.transitioned).toBe(false);
    if (!bare.transitioned) expect(bare.reason).toBe("illegal");
    const linked = await store.transitionCluster(
      a.cluster.id,
      { from: "TRIAGED", to: "LINKED", actor: "op", linkRef: "MYPROJ-1" },
      ev,
    );
    expect(linked.transitioned).toBe(true);
  });
});

describe("R1 H5 — per-attempt event keys survive status cycles", () => {
  it("OPEN→TRIAGED→OPEN→TRIAGED cycle completes (second same-hop ≠ replay)", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    const triage = (to: string, idem: string) =>
      admin(app, key, `/api/admin/demand/clusters/${a.cluster.id}/triage`, {
        method: "POST", body: { to }, idem,
      });
    expect((await triage("TRIAGED", "cycle-aa")).status).toBe(200);
    expect((await triage("OPEN", "cycle-bb")).status).toBe(200);
    // Same logical hop a second time — unique event keys mean the
    // append does not collide on PG's event idempotency constraint.
    const again = await triage("TRIAGED", "cycle-cc");
    expect(again.status).toBe(200);
    const events = await store.listEvents("cluster", a.cluster.id);
    expect(events.filter((e) => e.kind === "demand.cluster.updated").length)
      .toBeGreaterThanOrEqual(3);
  });
});

describe("R2 N1 — retag preserves capabilityKey (adapter pass-through)", () => {
  it("retag without capabilityKey keeps the signal's existing key", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    const cap = (await store.getSignal(a.signal.id))?.capabilityKey;
    expect(cap).not.toBeNull();
    const r = await admin(
      app, key, `/api/admin/demand/signals/${a.signal.id}/retag`,
      { method: "POST", body: { category: "identity" }, idem: "n1-retag-1" },
    );
    expect(r.status).toBe(200);
    const after = await store.getSignal(a.signal.id);
    expect(after?.capabilityKey).toBe(cap);
  });
});

describe("R2 N2 — listEvents cap keeps the NEWEST window", () => {
  it("with > limit events, the tail (newest) is returned, not the head", async () => {
    const store = createMemoryDemandStores();
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    for (let i = 0; i < 12; i++) {
      await store.appendEvents("cluster", a.cluster.id, [
        {
          kind: "demand.cluster.updated",
          visibility: "INTERNAL",
          payload: { marker: `ev-${i}` },
          idempotencyKey: `n2-ev-${i}`,
        },
      ]);
    }
    const events = await store.listEvents("cluster", a.cluster.id, { limit: 5 });
    expect(events.length).toBe(5);
    const markers = events.map((e) => (e.payload as { marker?: string }).marker);
    expect(markers).toEqual(["ev-7", "ev-8", "ev-9", "ev-10", "ev-11"]);
  });
});

describe("R2 L-4 — transition patch can't bypass the EDITABLE guard", () => {
  it("LINKED→CLOSED with patch.title leaves the exported row untouched", async () => {
    const store = createMemoryDemandStores();
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    const { transitionDemandOpportunity, updateDemandOpportunity } =
      await import("../../src/server/lib/demand/operator-ops-opportunities");
    const ev = (k: string) => ({
      kind: "demand.opportunity.updated",
      visibility: "INTERNAL" as const,
      payload: {},
      idempotencyKey: k,
    });
    const created = await store.createOpportunity(
      { id: "do_l4", clusterId: a.cluster.id, title: "orig", createdBy: "op" },
      [ev("l4-create")],
    );
    await store.transitionOpportunity(
      "do_l4", { from: "PROPOSED", to: "EVALUATING", actor: "op" }, ev("l4-ev"),
    );
    await store.transitionOpportunity(
      "do_l4", { from: "EVALUATING", to: "ACCEPTED", actor: "op" }, ev("l4-acc"),
    );
    await store.linkBacklogTask("do_l4", "MYPROJ-1", { status: "ACCEPTED" }, ev("l4-link"));
    // LINKED is terminal-guarded: patch on the CLOSED leg must not write.
    const closed = await transitionDemandOpportunity(
      store, "do_l4", "CLOSED",
      { patch: { title: "HIJACKED", declineReason: "n/a" } }, "op",
    );
    expect(closed.ok).toBe(true);
    const after = await store.getOpportunity("do_l4");
    expect(after?.title).toBe("orig");
    expect(after?.declineReason).toBeNull();
    void created; void updateDemandOpportunity;
  });
});

describe("R2 L-10 — prototype keys can't pass the level allowlist", () => {
  it('"constructor"/"toString" declared levels clamp to INTEREST, not a crash', async () => {
    const store = createMemoryDemandStores();
    const a = await ingest(store, {
      declaredLevel: "constructor" as never,
      text: "prototype pollution attempt",
    });
    if (!a.ok) throw new Error("ingest failed");
    const sig = await store.getSignal(a.signal.id);
    expect(sig?.level).toBe("INTEREST");
  });
});

describe("R2 L-8 — inflection-tolerant dictionary classify", () => {
  it('"refunded"/"paying" hit the same rules as "refund"/"payment"', async () => {
    const { classifyDemandText } = await import(
      "../../src/server/lib/demand/vocabulary"
    );
    expect(classifyDemandText("please process the refunds").category).toBe("payments");
    expect(classifyDemandText("please process the refunds").feature).toBe("refunds");
    expect(classifyDemandText("paying too much for escrow").category).toBe("payments");
    expect(classifyDemandText("deployed agents need monitoring").category)
      .toBe("observability");
  });
});

describe("R2 L-3 — SSR text fields get caps + ctrl reject", () => {
  it("overlong title on the opportunity form → flash err, no write", async () => {
    const { mintFormToken } = await import(
      "../../src/server/lib/knowledge/form-tokens"
    );
    const { createAdminDemandUi } = await import(
      "../../src/server/routes/admin-demand-ui"
    );
    const store = createMemoryDemandStores();
    const opStore = createMemoryOperatorStore();
    const { key } = await seedOperator(opStore);
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    const app = new Hono();
    app.route("/", createAdminDemandUi(store, opStore));
    const res = await app.request(`/admin/demand/clusters/${a.cluster.id}/opportunity`, {
      method: "POST",
      headers: {
        "x-admin-key": key,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        formToken: mintFormToken(),
        title: "x".repeat(500),
      }).toString(),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("field_too_long");
    expect(await store.listOpportunities({})).toHaveLength(0);
  });
});

describe("R2 L-11 — dup of retagged canonical folds into the NEW cluster", () => {
  it("second identical request reports the canonical's current cluster", async () => {
    const { app, store, opStore } = mkApp();
    const { key } = await seedOperator(opStore);
    const a = await ingest(store, { declaredLevel: "INTEREST" });
    if (!a.ok) throw new Error("seed failed");
    // Retag the canonical into a different dict cluster.
    const r = await admin(
      app, key, `/api/admin/demand/signals/${a.signal.id}/retag`,
      { method: "POST", body: { category: "identity" }, idem: "l11-retag-1" },
    );
    expect(r.status).toBe(200);
    const newClusterId = a.cluster.id === (await r.json()).cluster?.id
      ? null
      : (await store.getSignal(a.signal.id))?.clusterId;
    // A burst-dup of the same text+actor must fold into the canonical's
    // CURRENT cluster, not the stale one its own key would mint.
    const b = await ingest(store, { declaredLevel: "INTEREST" });
    if (!b.ok) throw new Error("second ingest failed");
    const canonical = await store.getSignal(a.signal.id);
    expect(b.signal.relatedSignalId).toBe(a.signal.id);
    expect(b.signal.clusterId).toBe(canonical?.clusterId);
    expect(b.cluster.id).toBe(canonical?.clusterId);
    void newClusterId;
  });
});
