import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@agentbadge/database";

import {
  DbKnowledgeStore,
  gapOverdueId,
  onKnowledgeEvent,
  recordGap,
  setKnowledgeEventsGateForTests,
  sweepOverdueGaps,
  type KnowledgeStore,
} from "../src/server/lib/knowledge";
import { mkGapStore } from "./helpers/knowledge";

/**
 * SLICE-264-13 (C8): durable overdue-breach records + sweeper —
 * memory-backend parity suite for the DoD. The PG semantics live in
 * the package repo test (unique constraint + liveness query);
 * this file covers the sweep contract end-to-end.
 */

const PAST = "2020-01-01T00:00:00.000Z";
const PAST2 = "2020-01-02T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

type SweepStore = Pick<
  KnowledgeStore,
  | "recordGap"
  | "assignGap"
  | "transitionGap"
  | "listDueBreaches"
  | "recordOverdue"
  | "markOverdueEmitted"
>;

async function seedBreached(store: SweepStore, dueAt: string) {
  const r = await recordGap(store as KnowledgeStore, {
    query: `q ${gapOverdueId()}`,
    source: "MANUAL",
  });
  const gap = r.ok && r.gap ? r.gap : null;
  if (!gap) throw new Error("seed failed");
  await store.assignGap(gap.id, {
    assignedTo: "op_a",
    assignedBy: "op_a",
    assignedAt: new Date().toISOString(),
    dueAt,
    expectedAssignedTo: null,
  });
  return gap;
}

describe("SLICE-264-13: overdue sweeper (memory)", () => {
  afterEach(() => setKnowledgeEventsGateForTests(null));

  it("tick: breached gap → record + emit + emittedAt stamp", async () => {
    const { store } = await mkGapStore();
    const gap = await seedBreached(store, PAST);
    const emitted: Record<string, unknown>[] = [];
    const r = await sweepOverdueGaps({
      store,
      emit: (k, p) => emitted.push({ kind: k, ...p }),
    });
    expect(r).toMatchObject({ scanned: 1, recorded: 1, emitted: 1 });
    expect(emitted).toHaveLength(1);
    // Closed-vocab kind + the spec'd payload shape.
    expect(emitted[0].kind).toBe("knowledge.gap_overdue");
    expect(emitted[0]).toMatchObject({
      gapId: gap.id,
      dueAt: PAST,
      normalizedQuery: gap.normalizedQuery,
      count: gap.count,
    });
  });

  it("repeat tick records nothing new and never re-emits", async () => {
    const { store } = await mkGapStore();
    await seedBreached(store, PAST);
    const first = await sweepOverdueGaps({ store, emit: () => {} });
    expect(first.recorded).toBe(1);
    const emitted: unknown[] = [];
    const second = await sweepOverdueGaps({
      store,
      emit: (k, p) => emitted.push(p),
    });
    // Same (gapId,dueAt) generation: conflict row, emittedAt set.
    expect(second).toMatchObject({ scanned: 1, recorded: 0, emitted: 0 });
    expect(emitted).toHaveLength(0);
  });

  it("a deadline moved forward after a breach is a NEW generation", async () => {
    const { store } = await mkGapStore();
    const gap = await seedBreached(store, PAST);
    await sweepOverdueGaps({ store, emit: () => {} });
    // dueAt extended — (gapId,PAST2) is a distinct breach row.
    await store.assignGap(gap.id, {
      assignedTo: "op_a",
      assignedBy: "op_a",
      assignedAt: new Date().toISOString(),
      dueAt: PAST2,
      expectedAssignedTo: "op_a",
    });
    const emitted: Record<string, unknown>[] = [];
    const r = await sweepOverdueGaps({
      store,
      emit: (k, p) => emitted.push(p),
    });
    expect(r.recorded).toBe(1);
    expect(r.emitted).toBe(1);
    expect(emitted[0].dueAt).toBe(PAST2);
  });

  it("kill between record and emit — next tick catches emittedAt=null", async () => {
    const { store } = await mkGapStore();
    const gap = await seedBreached(store, PAST);
    // Simulate the dead tick: the breach row exists, no emit ran.
    const dead = await store.recordOverdue({
      id: gapOverdueId(),
      gapId: gap.id,
      dueAt: PAST,
    });
    expect(dead.row?.emittedAt).toBeNull();
    const emitted: unknown[] = [];
    const r = await sweepOverdueGaps({
      store,
      emit: (k, p) => emitted.push(p),
    });
    // Not "new" (row existed) but the signal still goes out.
    expect(r).toMatchObject({ scanned: 1, recorded: 0, emitted: 1 });
    expect(emitted).toHaveLength(1);
    // A second kill-style row on a DIFFERENT gap also catches up.
    const gap2 = await seedBreached(store, PAST);
    await store.recordOverdue({
      id: gapOverdueId(),
      gapId: gap2.id,
      dueAt: PAST,
    });
    const r2 = await sweepOverdueGaps({ store, emit: () => {} });
    expect(r2.emitted).toBe(1); // gap2 only — gap already stamped.
  });

  it("scan liveness — RESOLVED and future-due are not breaches", async () => {
    const { store } = await mkGapStore();
    const gap = await seedBreached(store, PAST);
    await seedBreached(store, FUTURE); // deadline hasn't arrived
    const open = await sweepOverdueGaps({ store, emit: () => {} });
    expect(open.scanned).toBe(1);
    await store.transitionGap(gap.id, {
      from: "OPEN",
      to: "TRIAGED",
      resolvedAt: null,
    });
    await store.transitionGap(gap.id, {
      from: "TRIAGED",
      to: "RESOLVED",
      resolvedAt: new Date().toISOString(),
    });
    const after = await sweepOverdueGaps({ store, emit: () => {} });
    expect(after.scanned).toBe(0);
  });

  it("no deadline set → never a breach row", async () => {
    const { store } = await mkGapStore();
    await store.recordGap({
      id: gapOverdueId(),
      normalizedQuery: `open ${gapOverdueId()}`,
      sampleQuery: "q",
      source: "MANUAL",
    });
    const r = await sweepOverdueGaps({ store, emit: () => {} });
    expect(r).toMatchObject({ scanned: 0, recorded: 0, emitted: 0 });
  });

  it("real bus wiring — gap_overdue lands in KNOWLEDGE_EVENT_KINDS", async () => {
    const { store } = await mkGapStore();
    const gap = await seedBreached(store, PAST);
    setKnowledgeEventsGateForTests(() => true);
    const seen: { kind: string; payload: Record<string, unknown> }[] = [];
    const off = onKnowledgeEvent((e) => {
      seen.push({ kind: e.kind, payload: e.payload });
    });
    try {
      await sweepOverdueGaps({ store }); // default emit — real bus
    } finally {
      off();
    }
    const hit = seen.find((e) => e.kind === "knowledge.gap_overdue");
    expect(hit?.payload.gapId).toBe(gap.id);
    expect(hit?.payload.dueAt).toBe(PAST);
  });
});

/**
 * PG backend — exercises the real adapter + the installed
 * @agentbadge/database artifact (migration + unique constraint
 * live there). Gated on KNOWLEDGE_PG_URL like the audit suite.
 */
const PG_URL = process.env["KNOWLEDGE_PG_URL"];
describe.skipIf(!PG_URL)("overdue sweeper — PG backend", () => {
  let database: Database | undefined;
  afterAll(async () => {
    await database?.close();
  });

  it("full DoD on DbKnowledgeStore — record, catch-up, new generation", async () => {
    database = createDatabase({ url: PG_URL, enabled: true });
    const k = database.knowledge;
    if (!k) throw new Error("knowledge repos missing");
    const store = new DbKnowledgeStore(k.core, k.taxonomy);
    const gap = await seedBreached(store, PAST);
    // Shared dev DB holds stale breached gaps — assertions scope to
    // THIS run's gap ids via the emit payloads, never absolute counts.
    const emitted: Record<string, unknown>[] = [];
    const collect = (k: string, p: Record<string, unknown>) =>
      emitted.push({ kind: k, ...p });
    const r1 = await sweepOverdueGaps({ store, emit: collect });
    expect(r1.recorded).toBeGreaterThanOrEqual(1);
    expect(
      emitted.find((e) => e.gapId === gap.id)?.dueAt,
    ).toBe(PAST);

    // Repeat tick: same generation → stamped row, no re-emit for
    // my gap (other rows already caught up in r1).
    const e2: Record<string, unknown>[] = [];
    await sweepOverdueGaps({ store, emit: (k, p) => e2.push(p) });
    expect(e2.some((e) => e.gapId === gap.id)).toBe(false);

    // Kill-style row on a second gap → catch-up emit (emittedAt null).
    const gap2 = await seedBreached(store, PAST);
    await store.recordOverdue({
      id: gapOverdueId(),
      gapId: gap2.id,
      dueAt: PAST,
    });
    const e3: Record<string, unknown>[] = [];
    await sweepOverdueGaps({ store, emit: (k, p) => e3.push(p) });
    expect(e3.some((e) => e.gapId === gap2.id)).toBe(true);

    // New deadline → new generation row + signal.
    await store.assignGap(gap.id, {
      assignedTo: "op_a",
      assignedBy: "op_a",
      assignedAt: new Date().toISOString(),
      dueAt: PAST2,
      expectedAssignedTo: "op_a",
    });
    const e4: Record<string, unknown>[] = [];
    await sweepOverdueGaps({ store, emit: (k, p) => e4.push(p) });
    expect(
      e4.find((e) => e.gapId === gap.id)?.dueAt,
    ).toBe(PAST2);
  });
});
