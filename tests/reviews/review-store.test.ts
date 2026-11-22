import { describe, expect, it } from "vitest";

import { REVIEW_CRITERIA_KEYS } from "@agentbadge/database";
import {
  createMemoryReviewStores,
  pickReviewStore,
} from "../../src/server/lib/reviews/db-stores";
import { criteriaForReview } from "../../src/server/lib/reviews/criteria";
import type {
  ReviewStore,
  ReviewSubmitInput,
} from "../../src/server/lib/reviews/store";
import {
  REVIEW_EVIDENCE_CAP,
  REVIEW_TRANSITIONS,
} from "../../src/server/lib/reviews/types";

/**
 * SLICE-230-1 contract test — the memory review backend exercises
 * the same ReviewStore semantics the Postgres adapter implements
 * (packages/database/tests/review-repository.test.ts is the PG-side
 * mirror): atomic submit + evidence, in-store status machine with
 * effects derived from `to`, two-sided evidence gate + ≤50 cap,
 * append-only decisions, honest refusals. D-143: DATABASE_ENABLED=off
 * serves through this fallback.
 */

let n = 0;
const mk = (over: Partial<ReviewSubmitInput> = {}): ReviewSubmitInput => {
  n += 1;
  return {
    id: `rv_t_${n}`,
    actorResolution: "ANON",
    dedupeScope: "t",
    reviewType: "API_SURFACE",
    workRef: `https://agentbadge.xyz/w/${n}`,
    ...over,
  };
};

const ev = (kind = "review.submitted") => ({
  kind,
  visibility: "PUBLIC",
  payload: {},
});

/** Full API_SURFACE rubric — Arc 230-8 moved the coverage check
 *  inside the store unit, so decide calls need the whole template. */
const RUBRIC = (over: Record<string, string> = {}) =>
  ["contract-accuracy", "error-shapes", "breaking-changes", "auth-and-limits"]
    .map((k) => ({ key: k, result: over[k] ?? "PASS" }));

const evRow = (reviewId: string, over: Record<string, unknown> = {}) => ({
  id: `ev_${crypto.randomUUID()}`,
  reviewId,
  type: "EXTERNAL_URL",
  uri: "https://example.com/proof",
  submittedBy: "AGENT",
  ...over,
});

const submit = (
  s: ReviewStore,
  over: Partial<ReviewSubmitInput> = {},
  evidence = [evRow("x")],
) =>
  s.submitReview(
    mk(over),
    evidence.map((e) => ({ ...e, reviewId: "" })),
    [ev()],
  );

/** Drive a fresh case to IN_REVIEW (claim). */
async function claim(s: ReviewStore, id: string, actor = "ops:1") {
  const r = await s.transitionReview(
    id,
    { from: "PENDING_TRIAGE", to: "IN_REVIEW", actor },
    ev("review.claimed"),
  );
  if (!r.transitioned) throw new Error("claim failed");
  return r.record;
}

describe("ReviewStore (memory backend, SLICE-230-1)", () => {
  it("submit creates PENDING_TRIAGE case + AGENT evidence + event, same unit", async () => {
    const s = createMemoryReviewStores();
    const { record, duplicate } = await submit(
      s,
      { agentCriteria: ["pls check auth"] },
      [evRow("x", { label: "demo" })],
    );
    expect(duplicate).toBe(false);
    expect(record.status).toBe("PENDING_TRIAGE");
    expect(record.assignee).toBeNull();
    expect(record.reopenCount).toBe(0);
    const evs = await s.listEvidence(record.id);
    expect(evs).toHaveLength(1);
    expect(evs[0].submittedBy).toBe("AGENT");
    const events = await s.listEvents(record.id);
    expect(events.map((e) => e.seq)).toEqual([1]);
  });

  it("idempotent replay → duplicate:true, no extra evidence/events", async () => {
    const s = createMemoryReviewStores();
    const a = await submit(s, { idempotencyKey: "k1" });
    const b = await s.submitReview(
      mk({ id: "rv_other", idempotencyKey: "k1" }),
      [evRow("x")],
      [ev()],
    );
    expect(b.duplicate).toBe(true);
    expect(b.record.id).toBe(a.record.id);
    expect(await s.listEvidence(a.record.id)).toHaveLength(1);
    expect(await s.listEvents(a.record.id)).toHaveLength(1);
  });

  it("claim stamps assignee + claimedAt from the ACTOR (effects from `to`)", async () => {
    const s = createMemoryReviewStores();
    const { record } = await submit(s);
    const rec = await claim(s, record.id, "ops:alice");
    expect(rec.status).toBe("IN_REVIEW");
    expect(rec.assignee).toBe("ops:alice");
    expect(rec.claimedAt).not.toBeNull();
  });

  it("status machine enforced inside the store — illegal jumps refused, nothing written", async () => {
    const s = createMemoryReviewStores();
    const { record } = await submit(s);
    const bad = await s.transitionReview(
      record.id,
      { from: "PENDING_TRIAGE", to: "DECIDED", actor: "ops:1" },
      ev("review.decided"),
    );
    expect(bad.transitioned).toBe(false);
    if (!bad.transitioned) expect(bad.reason).toBe("illegal");
    expect((await s.getReview(record.id))?.status).toBe("PENDING_TRIAGE");
    const wrong = await s.transitionReview(
      record.id,
      { from: "IN_REVIEW", to: "DECLINED", actor: "ops:1", declineReason: "SPAM" },
      ev("review.declined"),
    );
    expect(wrong.transitioned).toBe(false);
    if (!wrong.transitioned) expect(wrong.reason).toBe("status_mismatch");
  });

  it("DECLINED requires declineReason — precondition refusal", async () => {
    const s = createMemoryReviewStores();
    const { record } = await submit(s);
    const out = await s.transitionReview(
      record.id,
      { from: "PENDING_TRIAGE", to: "DECLINED", actor: "ops:1" },
      ev("review.declined"),
    );
    expect(out.transitioned).toBe(false);
    if (!out.transitioned) expect(out.reason).toBe("precondition_required");
    const ok = await s.transitionReview(
      record.id,
      {
        from: "PENDING_TRIAGE",
        to: "DECLINED",
        actor: "ops:1",
        declineReason: "OUT_OF_SCOPE",
      },
      ev("review.declined"),
    );
    expect(ok.transitioned).toBe(true);
    if (!ok.transitioned) throw new Error("unreachable");
    expect(ok.record.declineReason).toBe("OUT_OF_SCOPE");
  });

  it("decideReview is atomic: decision seq + DECIDED + auto-delivery", async () => {
    const s = createMemoryReviewStores();
    const { record } = await submit(s);
    // Decide outside IN_REVIEW refuses, writes nothing.
    const early = await s.decideReview(
      record.id,
      { outcome: "APPROVED", criteriaResults: [], summary: "ok", decidedBy: "ops:1" },
      ev("review.decided"),
    );
    expect(early.transitioned).toBe(false);
    await claim(s, record.id);
    const out = await s.decideReview(
      record.id,
      {
        outcome: "CHANGES_REQUESTED",
        criteriaResults: RUBRIC({ "contract-accuracy": "FAIL" }),
        summary: "fix it",
        decidedBy: "ops:1",
      },
      ev("review.decided"),
    );
    expect(out.transitioned).toBe(true);
    if (!out.transitioned) throw new Error("unreachable");
    expect(out.decision.seq).toBe(1);
    expect(out.record.status).toBe("DECIDED");
    expect(out.record.decidedAt).toBe(out.record.deliveredAt);
    expect(out.record.latestDecisionSeq).toBe(1);
    // Second decide refused — terminal flip already happened.
    const again = await s.decideReview(
      record.id,
      { outcome: "APPROVED", criteriaResults: [], summary: "x", decidedBy: "ops:1" },
      ev("review.decided"),
    );
    expect(again.transitioned).toBe(false);
    expect(await s.listDecisions(record.id)).toHaveLength(1);
  });

  it("reopen → REOPENED bumps reopenCount + clears decision stamps; return releases claim", async () => {
    const s = createMemoryReviewStores();
    const { record } = await submit(s);
    await claim(s, record.id, "ops:bob");
    await s.decideReview(
      record.id,
      { outcome: "REJECTED", criteriaResults: RUBRIC(), summary: "no", decidedBy: "ops:bob" },
      ev("review.decided"),
    );
    const ro = await s.transitionReview(
      record.id,
      { from: "DECIDED", to: "REOPENED", actor: "ops:bob", reason: "new evidence" },
      ev("review.reopened"),
    );
    expect(ro.transitioned).toBe(true);
    if (!ro.transitioned) throw new Error("unreachable");
    expect(ro.record.reopenCount).toBe(1);
    expect(ro.record.decidedAt).toBeNull();
    expect(ro.record.deliveredAt).toBeNull();
    // Old decision preserved (append-only); latestDecisionSeq kept.
    expect((await s.listDecisions(record.id))[0].outcome).toBe("REJECTED");
    const back = await s.transitionReview(
      record.id,
      { from: "REOPENED", to: "PENDING_TRIAGE", actor: "ops:bob" },
      ev("review.returned"),
    );
    if (!back.transitioned) throw new Error("unreachable");
    expect(back.record.assignee).toBeNull();
    expect(back.record.claimedAt).toBeNull();
  });

  it("evidence gate: AGENT only while PENDING_TRIAGE, OPERATOR only while IN_REVIEW", async () => {
    const s = createMemoryReviewStores();
    const { record } = await submit(s);
    const topUp = await s.addEvidence(record.id, [evRow(record.id)]);
    expect(topUp.ok).toBe(true);
    // Operator cannot attach while pending.
    const opEarly = await s.addEvidence(record.id, [
      evRow(record.id, { submittedBy: "OPERATOR" }),
    ]);
    expect(opEarly.ok).toBe(false);
    if (!opEarly.ok) expect(opEarly.reason).toBe("not_editable");
    await claim(s, record.id);
    // Agent top-up window closed once claimed.
    const late = await s.addEvidence(record.id, [evRow(record.id)]);
    expect(late.ok).toBe(false);
    const op = await s.addEvidence(record.id, [
      evRow(record.id, { submittedBy: "OPERATOR" }),
    ]);
    expect(op.ok).toBe(true);
    const missing = await s.addEvidence("rv_none", [evRow("rv_none")]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing");
  });

  it("evidence cap ≤50 enforced inside the store", async () => {
    const s = createMemoryReviewStores();
    const rows = Array.from({ length: REVIEW_EVIDENCE_CAP }, () => evRow("x"));
    const { record } = await submit(s, {}, rows);
    expect(await s.listEvidence(record.id)).toHaveLength(REVIEW_EVIDENCE_CAP);
    const over = await s.addEvidence(record.id, [evRow(record.id)]);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("cap_exceeded");
    expect(await s.listEvidence(record.id)).toHaveLength(REVIEW_EVIDENCE_CAP);
  });

  it("markKnowledgeConverted stamps flags + event (CAS)", async () => {
    const s = createMemoryReviewStores();
    const { record } = await submit(s);
    const out = await s.markKnowledgeConverted(
      record.id,
      "ki_9",
      {
        kind: "review.knowledge_converted",
        visibility: "INTERNAL",
        payload: {},
      },
      { status: "PENDING_TRIAGE", latestDecisionSeq: null },
    );
    expect(out.marked).toBe(true);
    if (out.marked) {
      expect(out.record.knowledgeConverted).toBe(true);
      expect(out.record.knowledgeItemId).toBe("ki_9");
    }
    // CAS refusals: double convert + decision drift (a reopen + new
    // decide bumps latestDecisionSeq — the stale claim must refuse).
    const again = await s.markKnowledgeConverted(
      record.id,
      "ki_10",
      { kind: "review.knowledge_converted", visibility: "INTERNAL", payload: {} },
      { status: "PENDING_TRIAGE", latestDecisionSeq: null },
    );
    expect(again).toEqual({ marked: false, reason: "already_converted" });
  });

  it("queue FIFO + filters", async () => {
    const s = createMemoryReviewStores();
    const a = await submit(s, { reviewType: "DOCS" });
    const b = await submit(s, { reviewType: "API_SURFACE" });
    const all = await s.listReviews({ status: "PENDING_TRIAGE" });
    const mine = all
      .filter((r) => r.id === a.record.id || r.id === b.record.id)
      .map((r) => r.id);
    expect(mine).toEqual([a.record.id, b.record.id]);
    const docs = await s.listReviews({ reviewType: "DOCS" });
    expect(docs.map((r) => r.id)).toContain(a.record.id);
    expect(docs.map((r) => r.id)).not.toContain(b.record.id);
  });

  it("transition table mirrors the documented lifecycle", () => {
    expect([...REVIEW_TRANSITIONS.PENDING_TRIAGE].sort()).toEqual(
      ["DECLINED", "IN_REVIEW"].sort(),
    );
    // Arc 230-8 H3: DECIDED is decideReview's edge only — the generic
    // transition table must not expose it.
    expect([...REVIEW_TRANSITIONS.IN_REVIEW].sort()).toEqual(["DECLINED"]);
    expect([...REVIEW_TRANSITIONS.DECIDED]).toEqual(["REOPENED"]);
    expect([...REVIEW_TRANSITIONS.REOPENED]).toEqual(["PENDING_TRIAGE"]);
    expect(REVIEW_TRANSITIONS.DECLINED.size).toBe(0);
  });

  it("repo REVIEW_CRITERIA_KEYS mirrors the lib templates (Arc H3 note)", () => {
    // The PG repo can't import lib code — its store-level decide
    // guards run against this exported mirror. If a template key is
    // added/renamed in criteria.ts this test forces the mirror to
    // move with it.
    for (const type of [
      "API_SURFACE",
      "DOCS",
      "CODE_SNIPPET",
      "INTEGRATION",
      "OTHER",
    ]) {
      const template = criteriaForReview(type);
      const mirror = REVIEW_CRITERIA_KEYS[type];
      expect(mirror, `missing mirror for ${type}`).toBeDefined();
      expect([...mirror!.allowed].sort()).toEqual(
        template.map((c) => c.key).sort(),
      );
      expect([...mirror!.required].sort()).toEqual(
        template.filter((c) => c.required).map((c) => c.key).sort(),
      );
    }
  });

  it("store-level decide guards: facade bypass still refuses", async () => {
    // Arc 230-8 H3 note — the invariants live in the store unit, so
    // calling store.decideReview directly with a bad rubric refuses.
    const s = createMemoryReviewStores();
    const { record } = await submit(s, { reviewType: "DOCS" });
    await s.transitionReview(
      record.id,
      { from: "PENDING_TRIAGE", to: "IN_REVIEW", actor: "ops:alice" },
      { kind: "review.claimed", visibility: "INTERNAL", payload: {} },
    );
    const ev = {
      kind: "review.decided",
      visibility: "INTERNAL" as const,
      payload: {},
    };
    const wrongAssignee = await s.decideReview(
      record.id,
      {
        outcome: "APPROVED",
        criteriaResults: [],
        summary: "x",
        decidedBy: "ops:mallory",
      },
      ev,
    );
    expect(wrongAssignee.transitioned).toBe(false);
    if (!wrongAssignee.transitioned) {
      expect(wrongAssignee.reason).toBe("not_assignee");
    }
    const partial = await s.decideReview(
      record.id,
      {
        outcome: "APPROVED",
        criteriaResults: [{ key: "accuracy", result: "PASS" }],
        summary: "x",
        decidedBy: "ops:alice",
      },
      ev,
    );
    expect(partial.transitioned).toBe(false);
    if (!partial.transitioned) {
      expect(partial.reason).toBe("missing_criteria");
    }
    const rubberStamp = await s.decideReview(
      record.id,
      {
        outcome: "APPROVED",
        criteriaResults: [
          { key: "accuracy", result: "NA" },
          { key: "completeness", result: "PASS" },
          { key: "examples-valid", result: "PASS" },
          { key: "links-integrity", result: "PASS" },
        ],
        summary: "x",
        decidedBy: "ops:alice",
      },
      ev,
    );
    expect(rubberStamp.transitioned).toBe(false);
    if (!rubberStamp.transitioned) {
      expect(rubberStamp.reason).toBe("inconsistent_outcome");
    }
  });

  it("pick falls back to shared memory when repos absent", async () => {
    const a = pickReviewStore({});
    const b = pickReviewStore({});
    expect(a.backend).toBe("memory");
    expect(a).toBe(b);
  });
});
