import { describe, expect, it } from "vitest";

import {
  createMemoryDemandStores,
  pickDemandStore,
} from "../../src/server/lib/demand/db-stores";
import type {
  DemandSignalInput,
  DemandStore,
} from "../../src/server/lib/demand/store";
import {
  DEMAND_CLUSTER_TRANSITIONS,
  DEMAND_OPPORTUNITY_TRANSITIONS,
} from "../../src/server/lib/demand/types";

/**
 * SLICE-231-1 contract test — the memory demand backend exercises
 * the same DemandStore semantics the Postgres adapter implements
 * (packages/database/tests/demand-repository.test.ts is the PG-side
 * mirror): atomic recordSignal + burst-dedup, canonical-only cluster
 * recounts, in-store status machines with honest refusals,
 * append-only events. D-143: DATABASE_ENABLED=off serves through
 * this fallback.
 */

let n = 0;
const mk = (over: Partial<DemandSignalInput> = {}): DemandSignalInput => {
  n += 1;
  return {
    id: `ds_t_${n}`,
    source: "DEMAND_API",
    dedupeScope: "t",
    normalizedText: `need feature ${n}`,
    declaredLevel: "INTENT",
    level: "INTENT",
    actorResolution: "ANON",
    actorRef: `anon:b_${n}`,
    dedupeKey: `dk_${n}`,
    createdAtMs: Date.now(),
    ...over,
  };
};

const ev = (kind = "demand.signal.created") => ({
  kind,
  visibility: "INTERNAL",
  payload: {},
});

const record = (
  s: DemandStore,
  key = "ck_a",
  over: Partial<DemandSignalInput> = {},
) => s.recordSignal(mk(over), key, { signal: [ev()] });

describe("DemandStore (memory backend, SLICE-231-1)", () => {
  it("recordSignal creates OPEN cluster + canonical counters + events", async () => {
    const s = createMemoryDemandStores();
    const { signal, cluster, canonicalOf, duplicate } = await record(s);
    expect(duplicate).toBe(false);
    expect(canonicalOf).toBeNull();
    expect(cluster.clusterKey).toBe("ck_a");
    expect(cluster.status).toBe("OPEN");
    expect(cluster.count).toBe(1);
    expect(cluster.uniqueActors).toBe(1);
    // Arc 231 R1 H1: the cluster seeds INTEREST — a signal's
    // declaredLevel feeds levelBreakdown, never cluster.level.
    expect(cluster.level).toBe("INTEREST");
    expect(cluster.levelBreakdown).toEqual({ INTENT: 1 });
    expect(signal.clusterId).toBe(cluster.id);
    const sev = await s.listEvents("signal", signal.id);
    expect(sev.map((e) => e.seq)).toEqual([1]);
    expect(sev[0].kind).toBe("demand.signal.created");
  });

  it("idempotent replay → duplicate:true, no extra rows/events", async () => {
    const s = createMemoryDemandStores();
    const a = await record(s, "ck_idem", { idempotencyKey: "k1" });
    const b = await s.recordSignal(mk({ id: "ds_other", idempotencyKey: "k1" }), "ck_idem", {
      signal: [ev()],
    });
    expect(b.duplicate).toBe(true);
    expect(b.signal.id).toBe(a.signal.id);
    expect(await s.getSignal("ds_other")).toBeNull();
    expect(await s.listSignals({ clusterId: a.cluster.id })).toHaveLength(1);
    expect(await s.listEvents("signal", a.signal.id)).toHaveLength(1);
  });

  it("burst-dedup threads same-dedupeKey repeats under canonical; cluster counts canonical only", async () => {
    const s = createMemoryDemandStores();
    const a = await record(s, "ck_dedup", { dedupeKey: "same", actorRef: "x" });
    const b = await record(s, "ck_dedup", { dedupeKey: "same", actorRef: "x" });
    const c = await record(s, "ck_dedup", { dedupeKey: "same", actorRef: "x" });
    expect(b.canonicalOf).toBe(a.signal.id);
    expect(c.canonicalOf).toBe(a.signal.id);
    const canon = await s.getSignal(a.signal.id);
    expect(canon!.relatedCount).toBe(3);
    const cluster = await s.getCluster(a.cluster.id);
    expect(cluster!.count).toBe(1);
    expect(cluster!.uniqueActors).toBe(1);
  });

  it("distinct actors raise uniqueActors; NULL actorRef collapses to one unattributed", async () => {
    const s = createMemoryDemandStores();
    await record(s, "ck_actors", { actorRef: "a1" });
    await record(s, "ck_actors", { actorRef: "a2" });
    await record(s, "ck_actors", { actorRef: null, actorResolution: "ANON" });
    await record(s, "ck_actors", { actorRef: null, actorResolution: "ANON" });
    const clusters = await s.listClusters({});
    const c = clusters.find((x) => x.clusterKey === "ck_actors")!;
    expect(c.count).toBe(4);
    // a1, a2, (ANON,NULL)×1 unattributed
    expect(c.uniqueActors).toBe(3);
  });

  it("cluster level ignores signal levels — INTEREST seed, floors/operator only (R1 H1)", async () => {
    const s = createMemoryDemandStores();
    await record(s, "ck_lvl", { level: "INTEREST", actorRef: "a1" });
    const r2 = await record(s, "ck_lvl", {
      level: "PURCHASE_INTENT",
      actorRef: "a2",
    });
    // A self-declared PURCHASE_INTENT must NOT move the cluster —
    // level moves via applyClusterLevel (floors) or operator only.
    expect(r2.cluster.level).toBe("INTEREST");
    const r3 = await record(s, "ck_lvl", { level: "INTEREST", actorRef: "a3" });
    expect(r3.cluster.level).toBe("INTEREST");
    expect(r3.cluster.levelBreakdown).toEqual({
      INTEREST: 2,
      PURCHASE_INTENT: 1,
    });
  });

  it("applyClusterLevel: CAS drift refusal then promoted with event", async () => {
    const s = createMemoryDemandStores();
    const { cluster } = await record(s, "ck_cas");
    const drift = await s.applyClusterLevel(
      cluster.id,
      { from: "NEED", to: "VERIFIED_DEMAND" },
      ev("demand.cluster.updated"),
    );
    expect(drift.transitioned).toBe(false);
    if (!drift.transitioned) expect(drift.reason).toBe("status_mismatch");
    const ok = await s.applyClusterLevel(
      cluster.id,
      { from: "INTEREST", to: "VERIFIED_DEMAND" },
      ev("demand.cluster.updated"),
    );
    expect(ok.transitioned).toBe(true);
    if (ok.transitioned) {
      expect(ok.record.level).toBe("VERIFIED_DEMAND");
      expect(ok.event.kind).toBe("demand.cluster.updated");
    }
    const missing = await s.applyClusterLevel("nope", { from: "X", to: "Y" }, ev());
    expect(missing.transitioned).toBe(false);
    if (!missing.transitioned) expect(missing.reason).toBe("missing");
  });

  it("transitionCluster: machine mirrors DEMAND_CLUSTER_TRANSITIONS", async () => {
    const s = createMemoryDemandStores();
    const { cluster } = await record(s, "ck_machine");
    const illegal = await s.transitionCluster(
      cluster.id,
      { from: "OPEN", to: "LINKED", actor: "op" },
      ev("demand.cluster.updated"),
    );
    expect(illegal.transitioned).toBe(false);
    if (!illegal.transitioned) expect(illegal.reason).toBe("illegal");
    // sanity: table mirrors what the store enforces
    expect(DEMAND_CLUSTER_TRANSITIONS.OPEN.has("LINKED")).toBe(false);
    const ok = await s.transitionCluster(
      cluster.id,
      { from: "OPEN", to: "TRIAGED", actor: "op" },
      ev("demand.cluster.updated"),
    );
    expect(ok.transitioned).toBe(true);
    if (ok.transitioned) expect(ok.record.status).toBe("TRIAGED");
  });

  it("opportunity lifecycle + linkBacklogTask CAS", async () => {
    const s = createMemoryDemandStores();
    const { cluster } = await record(s, "ck_opp");
    const { record: opp, created } = await s.createOpportunity(
      {
        id: "do_1",
        clusterId: cluster.id,
        title: "cap",
        metricsSnapshot: { count: 1 },
        createdBy: "op",
      },
      [ev("demand.opportunity.created")],
    );
    expect(created).toBe(true);
    expect(opp!.status).toBe("PROPOSED");
    const early = await s.linkBacklogTask(
      "do_1",
      "MYPROJ-9",
      { status: "ACCEPTED" },
      ev("demand.opportunity.linked"),
    );
    expect(early.linked).toBe(false);
    if (!early.linked) expect(early.reason).toBe("status_mismatch");
    for (const [from, to] of [
      ["PROPOSED", "EVALUATING"],
      ["EVALUATING", "ACCEPTED"],
    ] as const) {
      const t = await s.transitionOpportunity(
        "do_1",
        { from, to, actor: "op" },
        ev("demand.opportunity.updated"),
      );
      expect(t.transitioned).toBe(true);
    }
    const linked = await s.linkBacklogTask(
      "do_1",
      "MYPROJ-9",
      { status: "ACCEPTED" },
      ev("demand.opportunity.linked"),
    );
    expect(linked.linked).toBe(true);
    if (linked.linked) {
      expect(linked.record.status).toBe("LINKED");
      expect(linked.record.backlogTaskId).toBe("MYPROJ-9");
    }
    const again = await s.linkBacklogTask(
      "do_1",
      "MYPROJ-10",
      { status: "ACCEPTED" },
      ev(),
    );
    expect(again.linked).toBe(false);
    if (!again.linked) expect(again.reason).toBe("already_linked");
  });

  it("opportunity create on missing cluster → created:false", async () => {
    const s = createMemoryDemandStores();
    const out = await s.createOpportunity(
      { id: "do_x", clusterId: "nope", title: "t", createdBy: "op" },
      [ev()],
    );
    expect(out.created).toBe(false);
    expect(out.record).toBeNull();
  });

  it("opportunity DECLINED sets closedAt; terminal refuses further moves", async () => {
    const s = createMemoryDemandStores();
    const { cluster } = await record(s, "ck_decl");
    await s.createOpportunity(
      { id: "do_d", clusterId: cluster.id, title: "t", createdBy: "op" },
      [],
    );
    await s.transitionOpportunity(
      "do_d",
      { from: "PROPOSED", to: "EVALUATING", actor: "op" },
      ev(),
    );
    const d = await s.transitionOpportunity(
      "do_d",
      { from: "EVALUATING", to: "DECLINED", actor: "op", now: "2026-11-24T00:00:00.000Z" },
      ev(),
    );
    expect(d.transitioned).toBe(true);
    if (d.transitioned) expect(d.record.closedAt).toBe("2026-11-24T00:00:00.000Z");
    const after = await s.transitionOpportunity(
      "do_d",
      { from: "DECLINED", to: "ACCEPTED", actor: "op" },
      ev(),
    );
    expect(after.transitioned).toBe(false);
    if (!after.transitioned) expect(after.reason).toBe("illegal");
    expect(DEMAND_OPPORTUNITY_TRANSITIONS.DECLINED.size).toBe(0);
  });

  it("retagSignal moves canonical signal + recounts both clusters; linked refuses", async () => {
    const s = createMemoryDemandStores();
    const a = await record(s, "ck_src", { actorRef: "a1" });
    const b = await record(s, "ck_src", { actorRef: "a2" });
    const out = await s.retagSignal(
      a.signal.id,
      { clusterKey: "ck_dst", category: "new", feature: "thing" },
      { signal: [ev("demand.signal.retagged")] },
    );
    expect(out.detached).toBe("ok");
    expect(out.signal!.clusterId).toBe(out.cluster!.id);
    const src = await s.getCluster(a.cluster.id);
    expect(src!.count).toBe(1);
    expect(out.cluster!.count).toBe(1);
    const moved = await s.retagSignal(b.signal.id, { clusterKey: "ck_dst" });
    // b.signal was canonical itself → moves too
    expect(moved.detached).toBe("ok");
    await record(s, "ck_src", { dedupeKey: "same_dk", actorRef: "z" });
    const dup2 = await record(s, "ck_src", { dedupeKey: "same_dk", actorRef: "z" });
    const rt = await s.retagSignal(dup2.signal.id, { clusterKey: "ck_dst" });
    expect(rt.detached).toBe("linked_row");
    const missing = await s.retagSignal("nope", { clusterKey: "ck_dst" });
    expect(missing.detached).toBe("missing");
  });

  it("appendEvents standalone: seq continues, parent-missing gets [], idempotency replays", async () => {
    const s = createMemoryDemandStores();
    const { cluster } = await record(s, "ck_ev");
    const first = await s.appendEvents("cluster", cluster.id, [
      { kind: "demand.cluster.updated", visibility: "INTERNAL", payload: {}, idempotencyKey: "evk1" },
    ]);
    expect(first).toHaveLength(1);
    const second = await s.appendEvents("cluster", cluster.id, [
      { kind: "demand.cluster.updated", visibility: "INTERNAL", payload: {}, idempotencyKey: "evk1" },
    ]);
    expect(second[0].id).toBe(first[0].id);
    const third = await s.appendEvents("cluster", cluster.id, [ev()]);
    expect(third[0].seq).toBe(2);
    const missing = await s.appendEvents("cluster", "nope", [ev()]);
    expect(missing).toEqual([]);
  });

  it("pickDemandStore: memory singleton fallback when db.demand is null", async () => {
    const a = pickDemandStore({ demand: null });
    const b = pickDemandStore({ demand: null });
    expect(a.backend).toBe("memory");
    expect(a).toBe(b);
    const { cluster } = await record(a, "ck_pick");
    expect((await b.getCluster(cluster.id))!.id).toBe(cluster.id);
  });

  it("listSignals filters + newest-first; listClusters sort options", async () => {
    const s = createMemoryDemandStores();
    await record(s, "ck_l1", { source: "INTERACTION", actorRef: "a1" });
    await record(s, "ck_l1", { source: "FEEDBACK", actorRef: "a2", level: "NEED" });
    await record(s, "ck_l2", { actorRef: "a3" });
    const fb = await s.listSignals({ source: "FEEDBACK" });
    expect(fb).toHaveLength(1);
    const canon = await s.listSignals({ canonicalOnly: true });
    expect(canon.every((x) => x.relatedSignalId === null)).toBe(true);
    const byActors = await s.listClusters({ sortBy: "uniqueActors" });
    expect(byActors[0]!.uniqueActors).toBeGreaterThanOrEqual(
      byActors[byActors.length - 1]!.uniqueActors,
    );
    const open = await s.listClusters({ status: "OPEN" });
    expect(open.every((c) => c.status === "OPEN")).toBe(true);
  });
});
