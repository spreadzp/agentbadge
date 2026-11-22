import { describe, expect, it } from "vitest";

import {
  createMemoryFeedbackStores,
  pickFeedbackStore,
} from "../../src/server/lib/feedback/db-stores";
import type {
  FeedbackStore,
  FeedbackSubmitInput,
} from "../../src/server/lib/feedback/store";
import { FEEDBACK_TRANSITIONS } from "../../src/server/lib/feedback/types";

/**
 * SLICE-230-1 contract test — the memory feedback backend exercises
 * the same FeedbackStore semantics the Postgres adapter implements
 * (packages/database/tests/feedback-repository.test.ts is the
 * PG-side mirror): atomic submit + auto-dedup, in-store status
 * machine with effects derived from `to`, honest refusals,
 * append-only events. D-143: DATABASE_ENABLED=off serves through
 * this fallback.
 */

let n = 0;
const mk = (over: Partial<FeedbackSubmitInput> = {}): FeedbackSubmitInput => {
  n += 1;
  return {
    id: `fb_t_${n}`,
    actorResolution: "ANON",
    dedupeScope: "t",
    text: `feedback text ${n}`,
    normalized: `norm_${n}`,
    ...over,
  };
};

const ev = (kind = "feedback.received") => ({
  kind,
  visibility: "PUBLIC",
  payload: {},
});

const submit = (s: FeedbackStore, over: Partial<FeedbackSubmitInput> = {}) =>
  s.submitFeedback(mk(over), [ev()]);

describe("FeedbackStore (memory backend, SLICE-230-1)", () => {
  it("submit creates RECEIVED row + received event, same unit", async () => {
    const s = createMemoryFeedbackStores();
    const { record, duplicate, relatedTo } = await submit(s, {
      kind: "BUG",
      target: "api",
      severity: "HIGH",
    });
    expect(duplicate).toBe(false);
    expect(relatedTo).toBeNull();
    expect(record.status).toBe("RECEIVED");
    expect(record.relatedCount).toBe(1);
    expect(record.relatedFeedbackId).toBeNull();
    const events = await s.listEvents(record.id);
    expect(events.map((e) => e.seq)).toEqual([1]);
    expect(events[0].kind).toBe("feedback.received");
  });

  it("idempotent replay → duplicate:true, no extra events", async () => {
    const s = createMemoryFeedbackStores();
    const a = await submit(s, { idempotencyKey: "k1" });
    const b = await s.submitFeedback(
      mk({ id: "fb_other", idempotencyKey: "k1" }),
      [ev()],
    );
    expect(b.duplicate).toBe(true);
    expect(b.record.id).toBe(a.record.id);
    expect(await s.listEvents(a.record.id)).toHaveLength(1);
    expect(await s.getFeedback("fb_other")).toBeNull();
  });

  it("auto-dedup threads same-normalized submits under the earliest open canonical", async () => {
    const s = createMemoryFeedbackStores();
    const a = await submit(s, { normalized: "same" });
    const b = await submit(s, { normalized: "same" });
    const c = await submit(s, { normalized: "same" });
    expect(b.relatedTo).toBe(a.record.id);
    expect(b.record.relatedFeedbackId).toBe(a.record.id);
    expect(c.relatedTo).toBe(a.record.id);
    const canon = await s.getFeedback(a.record.id);
    expect(canon?.relatedCount).toBe(3);
    // A closed canonical stops absorbing — next submit starts fresh.
    await s.transitionFeedback(
      a.record.id,
      { from: "RECEIVED", to: "TRIAGED", actor: "ops:1" },
      ev("feedback.triaged"),
    );
    await s.transitionFeedback(
      a.record.id,
      { from: "TRIAGED", to: "ACCEPTED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    await s.transitionFeedback(
      a.record.id,
      { from: "ACCEPTED", to: "CLOSED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    const d = await submit(s, { normalized: "same" });
    expect(d.relatedTo).toBeNull();
    expect(d.record.relatedFeedbackId).toBeNull();
  });

  it("status machine enforced inside the store — illegal jump refused, no writes", async () => {
    const s = createMemoryFeedbackStores();
    const { record } = await submit(s);
    const bad = await s.transitionFeedback(
      record.id,
      { from: "RECEIVED", to: "CLOSED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    expect(bad.transitioned).toBe(false);
    if (!bad.transitioned) expect(bad.reason).toBe("illegal");
    expect((await s.getFeedback(record.id))?.status).toBe("RECEIVED");
    expect(await s.listEvents(record.id)).toHaveLength(1);
    // Terminal CLOSED refuses everything.
    await s.transitionFeedback(
      record.id,
      { from: "RECEIVED", to: "TRIAGED", actor: "ops:1" },
      ev("feedback.triaged"),
    );
    await s.transitionFeedback(
      record.id,
      { from: "TRIAGED", to: "DECLINED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    await s.transitionFeedback(
      record.id,
      { from: "DECLINED", to: "CLOSED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    const term = await s.transitionFeedback(
      record.id,
      { from: "CLOSED", to: "TRIAGED", actor: "ops:1" },
      ev("feedback.triaged"),
    );
    expect(term.transitioned).toBe(false);
  });

  it("wrong `from` → status_mismatch (optimistic-concurrency refusal)", async () => {
    const s = createMemoryFeedbackStores();
    const { record } = await submit(s);
    const out = await s.transitionFeedback(
      record.id,
      { from: "TRIAGED", to: "ACCEPTED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    expect(out.transitioned).toBe(false);
    if (!out.transitioned) expect(out.reason).toBe("status_mismatch");
  });

  it("effects derive from `to`: triagedAt on TRIAGED, closedAt on CLOSED, patch on triage", async () => {
    const s = createMemoryFeedbackStores();
    const { record } = await submit(s);
    const t1 = await s.transitionFeedback(
      record.id,
      {
        from: "RECEIVED",
        to: "TRIAGED",
        actor: "ops:1",
        patch: { kind: "FEATURE", suggestion: "good idea" },
      },
      ev("feedback.triaged"),
    );
    expect(t1.transitioned).toBe(true);
    if (!t1.transitioned) throw new Error("unreachable");
    expect(t1.record.triagedAt).not.toBeNull();
    expect(t1.record.kind).toBe("FEATURE");
    expect(t1.record.suggestion).toBe("good idea");
    await s.transitionFeedback(
      record.id,
      { from: "TRIAGED", to: "ACCEPTED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    const t3 = await s.transitionFeedback(
      record.id,
      { from: "ACCEPTED", to: "CLOSED", actor: "ops:1" },
      ev("feedback.status_changed"),
    );
    if (!t3.transitioned) throw new Error("unreachable");
    expect(t3.record.closedAt).not.toBeNull();
    expect(t3.record.status).toBe("CLOSED");
  });

  it("missing row → reason missing", async () => {
    const s = createMemoryFeedbackStores();
    const out = await s.transitionFeedback(
      "fb_none",
      { from: "RECEIVED", to: "TRIAGED", actor: "ops:1" },
      ev("feedback.triaged"),
    );
    expect(out.transitioned).toBe(false);
    if (!out.transitioned) {
      expect(out.reason).toBe("missing");
      expect(out.record).toBeNull();
    }
  });

  it("events append-only with per-feedback seq", async () => {
    const s = createMemoryFeedbackStores();
    const { record } = await submit(s);
    await s.appendEvents(record.id, [
      { kind: "feedback.triaged", visibility: "INTERNAL", payload: { a: 1 } },
      { kind: "feedback.status_changed", visibility: "PUBLIC", payload: { a: 2 } },
    ]);
    const all = await s.listEvents(record.id);
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
    const pub = await s.listEvents(record.id, { visibility: "PUBLIC" });
    expect(pub.map((e) => e.seq)).toEqual([1, 3]);
  });

  it("markKnowledgeConverted stamps flags + event", async () => {
    const s = createMemoryFeedbackStores();
    const { record } = await submit(s);
    const out = await s.markKnowledgeConverted(
      record.id,
      "ki_1",
      ev("feedback.knowledge_converted"),
    );
    expect(out?.knowledgeConverted).toBe(true);
    expect(out?.knowledgeItemId).toBe("ki_1");
    expect(await s.markKnowledgeConverted("fb_none", "ki_1", ev())).toBeNull();
  });

  it("queue FIFO + filters + offset pagination", async () => {
    const s = createMemoryFeedbackStores();
    const a = await submit(s, { kind: "BUG", target: "api" });
    const b = await submit(s, { kind: "FEATURE", target: "docs" });
    const all = await s.listFeedback({ status: "RECEIVED" });
    const mine = all
      .filter((r) => r.id === a.record.id || r.id === b.record.id)
      .map((r) => r.id);
    expect(mine).toEqual([a.record.id, b.record.id]);
    const bugs = await s.listFeedback({ kind: "BUG" });
    expect(bugs.map((r) => r.id)).toContain(a.record.id);
    expect(bugs.map((r) => r.id)).not.toContain(b.record.id);
    const page = await s.listFeedback({ offset: 1, limit: 1 });
    expect(page).toHaveLength(1);
  });

  it("transition table mirrors the documented lifecycle", () => {
    expect([...FEEDBACK_TRANSITIONS.RECEIVED]).toEqual(["TRIAGED"]);
    expect([...FEEDBACK_TRANSITIONS.TRIAGED].sort()).toEqual(
      ["ACCEPTED", "DECLINED", "DUPLICATE"].sort(),
    );
    for (const t of ["ACCEPTED", "DECLINED", "DUPLICATE"] as const) {
      expect([...FEEDBACK_TRANSITIONS[t]]).toEqual(["CLOSED"]);
    }
    expect(FEEDBACK_TRANSITIONS.CLOSED.size).toBe(0);
  });

  it("pick falls back to shared memory when repos absent", async () => {
    const a = pickFeedbackStore({});
    const b = pickFeedbackStore({});
    expect(a.backend).toBe("memory");
    expect(a).toBe(b); // process-wide singleton, not a fresh map
  });
});
