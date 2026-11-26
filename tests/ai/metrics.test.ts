/**
 * SLICE-232-10 (E10, D-232-6): comparators per shipped scenario +
 * on-demand §17.3 projection (splits, agreement, linkage, mode split).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { getComparator, resetComparators } from "../../src/server/lib/ai/compare";
import { computeAiMetrics } from "../../src/server/lib/ai/metrics/projection";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import {
  createMemoryRequestInboxStores,
  type RequestInboxStores,
} from "../../src/server/lib/request-inbox";
import { createMemoryReviewData, createMemoryReviewStore } from "../../src/server/lib/reviews/store-memory";
import type { ReviewStore } from "../../src/server/lib/reviews/store";
import { claimReview } from "../../src/server/lib/reviews/workflow";
import { decideReview } from "../../src/server/lib/reviews/decide";
import { buildReviewEvent } from "../../src/server/lib/reviews/events";

const FP = { ip: null, ua: null, referer: null, src: null, headers: {} };
let ai: InMemoryAiStore;
let inbox: RequestInboxStores;
let reviews: ReviewStore;

const seedRequest = (id: string) =>
  inbox.requests.submit({
    id,
    state: "submitted",
    payload: { text: "q" },
    fingerprint: FP,
    fpHash: "f",
    expiresAtMs: Date.now() + 60_000,
  });

const seedDecidedCase = async (id: string, opts: {
  outcome: string;
  aiRunRef?: string;
}) => {
  const { record } = await reviews.submitReview(
    {
      id,
      actorResolution: "did:x",
      dedupeScope: "s",
      reviewType: "OTHER",
      workRef: "w",
    },
    [],
    [],
  );
  await claimReview(reviews, record.id, "op-1");
  const d = await decideReview(
    reviews,
    record.id,
    {
      outcome: opts.outcome,
      summary: "s",
      criteriaResults: [
        { key: "accuracy", result: opts.outcome.startsWith("APPROV") ? "PASS" : "FAIL" },
        { key: "completeness", result: "NA" },
      ],
      aiRunRef: opts.aiRunRef ?? null,
    },
    "op-1",
  );
  expect(d.ok).toBe(true);
  return record;
};

const appendRun = (
  opts: Partial<Parameters<InMemoryAiStore["appendRun"]>[0]> = {},
) =>
  ai.appendRun({
    scenario: "classification",
    subjectType: "agent_request",
    subjectId: "ireq_m",
    modeAtTime: "shadow",
    status: "success",
    output: { intent: "INTEGRATION_HELP", category: "question" },
    ...opts,
  });

beforeEach(() => {
  ai = new InMemoryAiStore();
  inbox = createMemoryRequestInboxStores();
  reviews = createMemoryReviewStore(createMemoryReviewData());
  resetComparators();
});

describe("comparators — all shipped scenarios", () => {
  it("classification: intent + category fields", () => {
    const r = getComparator("classification")!(
      { intent: "A", category: "question" },
      { intent: "A", kind: "question" },
    );
    expect(r.agree).toBe(true);
    expect(r.fields).toHaveLength(2);
  });
  it("answer_draft: verbatim field", () => {
    const c = getComparator("answer_draft")!;
    expect(c({ draftText: "x" }, { body: "x" }).agree).toBe(true);
    expect(c({ draftText: "x" }, { body: "x!" }).agree).toBe(false);
    expect(c({ draftText: "x" }, {}).agree).toBeNull();
  });
  it("review_assist: per-criterion + outcome", () => {
    const c = getComparator("review_assist")!;
    const out = {
      criteria: [
        { name: "accuracy", passed: true },
        { name: "completeness", passed: false },
      ],
      recommendation: "CHANGES_REQUESTED",
    };
    const same = c(out, {
      outcome: "CHANGES_REQUESTED",
      criteriaResults: { accuracy: "PASS", completeness: "FAIL" },
    });
    expect(same.agree).toBe(true);
    const diff = c(out, {
      outcome: "APPROVED",
      criteriaResults: { accuracy: "PASS", completeness: "PASS" },
    });
    expect(diff.agree).toBe(false);
    expect(diff.fields.filter((f) => !f.match).map((f) => f.field)).toEqual([
      "criterion:completeness",
      "outcome",
    ]);
  });
  it("retrieval/extraction scenarios → honest n/a", () => {
    for (const s of ["summary", "knowledge_search", "feedback_extract"]) {
      expect(getComparator(s)!).toBeDefined();
      expect(getComparator(s)!({}, {}).agree).toBeNull();
    }
  });
});

describe("computeAiMetrics projection", () => {
  it("splits runs by scenario × modeAtTime", async () => {
    await appendRun({ id: "r1" });
    await appendRun({ id: "r2", modeAtTime: "assist" });
    await appendRun({ id: "r3", scenario: "review_assist", subjectType: "review_case", status: "skipped" });
    const m = await computeAiMetrics({ aiStore: ai, reviews, interactions: inbox.interactions });
    const cells = Object.fromEntries(
      m.splits.map((c) => [`${c.scenario}@${c.modeAtTime}`, c]),
    );
    expect(cells["classification@shadow"]!.runs).toBe(1);
    expect(cells["classification@assist"]!.runs).toBe(1);
    expect(cells["review_assist@shadow"]!.skipped).toBe(1);
  });

  it("shadow agreement join counts agree/disagree from events", async () => {
    const req = (await seedRequest("ireq_m")).record;
    const run = await appendRun();
    await inbox.interactions.appendEvents(req.id, [
      {
        id: "ev1",
        kind: "ai.agreement.computed",
        visibility: "INTERNAL",
        payload: { runId: run.id, agree: true, scenario: "classification" },
      },
    ]);
    const m = await computeAiMetrics({ aiStore: ai, reviews, interactions: inbox.interactions });
    expect(m.agreement.compared).toBe(1);
    expect(m.agreement.agreed).toBe(1);
    expect(m.agreement.disagreed).toBe(0);
  });

  it("review-side set: pending/decided/reopened/byOperator + rejection + FP + HIR", async () => {
    await reviews.submitReview(
      { id: "rv_p", actorResolution: "d", dedupeScope: "s", reviewType: "OTHER", workRef: "w" },
      [],
      [],
    );
    const run = await appendRun({
      id: "run_link",
      scenario: "review_assist",
      subjectType: "review_case",
      modeAtTime: "supervised",
      output: {
        criteria: [{ name: "accuracy", passed: true }],
        recommendation: "APPROVED",
        confidence: 0.9,
      },
    });
    await seedDecidedCase("rv_d1", { outcome: "REJECTED", aiRunRef: run.id });
    await reviews.appendEvents("rv_d1", [
      buildReviewEvent("review.ai_suggestion_rejected", "INTERNAL", {
        runId: run.id,
        actor: "op-1",
      }),
    ]);

    const m = await computeAiMetrics({ aiStore: ai, reviews, interactions: inbox.interactions });
    expect(m.reviews.pending).toBe(1);
    expect(m.reviews.decided).toBe(1);
    expect(m.reviews.byOperator["op-1"]).toBe(1);
    expect(m.agreement.rejectedSuggestions).toBe(1);
    // AI recommended APPROVED, human REJECTED → false positive + intervention
    expect(m.linkage.linked).toBe(1);
    expect(m.linkage.falsePositives).toBe(1);
    expect(m.linkage.falsePositiveRate).toBe(1);
    expect(m.linkage.interventions).toBe(1);
  });

  it("date window filter narrows the projection", async () => {
    await appendRun();
    await reviews.submitReview(
      { id: "rv_w", actorResolution: "d", dedupeScope: "s", reviewType: "OTHER", workRef: "w" },
      [],
      [],
    );
    const all = await computeAiMetrics({ aiStore: ai, reviews, interactions: inbox.interactions });
    expect(all.splits.reduce((n, c) => n + c.runs, 0)).toBe(1);
    expect(all.reviews.pending).toBe(1);
    // a `to` bound in the past excludes both the run and the case
    const past = await computeAiMetrics(
      { aiStore: ai, reviews, interactions: inbox.interactions },
      { to: "2020-01-01" },
    );
    expect(past.splits.reduce((n, c) => n + c.runs, 0)).toBe(0);
    expect(past.reviews.pending).toBe(0);
  });
});
