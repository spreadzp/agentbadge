/**
 * SLICE-232-9 (E9, D-232-3/4): supervised UX — review_assist run
 * prefills the decide form in supervised mode; confirm → human
 * decision + aiRunRef; reject → INTERNAL rejection event + manual
 * form; low-confidence → "human required", never prefills; queue
 * distinguishes confirm/suggested/manual.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { createReviewCenter } from "../../src/server/routes/feedback-review/review-center";
import { createMemoryFeedbackStore, createMemoryFeedbackData } from "../../src/server/lib/feedback/store-memory";
import { createMemoryReviewData, createMemoryReviewStore } from "../../src/server/lib/reviews/store-memory";
import type { ReviewStore } from "../../src/server/lib/reviews/store";
import { claimReview } from "../../src/server/lib/reviews/workflow";
import { knowledgeDraftPort } from "../../src/server/lib/knowledge-draft/port";
import { createMemoryKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import { resetIdempotencyStore } from "../../src/server/lib/contract-guards";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

const FORM = "application/x-www-form-urlencoded";

const CFG = {
  enabled: true,
  baseUrl: "https://llm.test",
  apiKey: "k",
  model: "m-1",
  dailyCallLimit: 0,
  monthlyBudgetUsd: 0,
  usdPer1MTokens: 1,
  shadowReserveCalls: 0,
  timeoutMs: 5_000,
  retryOnce: false,
  workerEnabled: true,
  workerIntervalMs: 5_000,
  jobLeaseMs: 60_000,
  jobMaxAttempts: 1,
  jobQueueCap: 500,
    subjectDailyCallLimit: 0,
};
const ASSIST = {
  criteria: [
    { name: "accuracy", passed: true, evidence: "doc-link" },
    { name: "completeness", passed: false },
  ],
  recommendation: "APPROVED_WITH_NOTES",
  confidence: 0.9,
};

let ai: InMemoryAiStore;
let reviews: ReviewStore;
let basic = "";
let operatorId = "";
let app: Hono;

const seedCase = async (id: string) => {
  const { record } = await reviews.submitReview(
    {
      id,
      actorResolution: "did:example:agent",
      dedupeScope: "s",
      reviewType: "OTHER",
      workRef: "https://x.test/w",
    },
    [],
    [],
  );
  // claim under the credential principal — decide refuses non-assignee
  const c = await claimReview(reviews, record.id, operatorId);
  expect(c.ok).toBe(true);
  return record;
};

const appendAssistRun = async (
  caseId: string,
  mode: string,
  confidence = 0.9,
) =>
  ai.appendRun({
    scenario: "review_assist",
    subjectType: "review_case",
    subjectId: caseId,
    modeAtTime: mode,
    status: "success",
    output: { ...ASSIST, confidence },
    confidence,
    promptVersion: "abc123def456",
  });

const getHtml = async (path: string) => {
  const r = await app.request(path, { headers: { authorization: basic } });
  return { status: r.status, html: await r.text() };
};

const tokenOf = (html: string) => {
  const m = html.match(/name="formToken" value="([^"]+)"/);
  expect(m).not.toBeNull();
  return m![1]!;
};

const post = (path: string, body: URLSearchParams) =>
  app.request(path, {
    method: "POST",
    headers: { authorization: basic, "content-type": FORM },
    body,
  });

beforeEach(async () => {
  resetIdempotencyStore();
  ai = new InMemoryAiStore();
  reviews = createMemoryReviewStore(createMemoryReviewData());
  const opStore = createMemoryOperatorStore();
  const { key, operatorId: oid } = await seedOperator(opStore, "Ops");
  operatorId = oid;
  basic = `Basic ${Buffer.from(`ops:${key}`).toString("base64")}`;
  app = new Hono();
  app.route(
    "/",
    createReviewCenter({
      stores: {
        feedback: createMemoryFeedbackStore(createMemoryFeedbackData()),
        reviews,
        draftPort: knowledgeDraftPort(createMemoryKnowledgeStores()),
      },
      operatorStore: opStore,
      aiStore: ai,
      aiConfig: () => CFG,
    }),
  );
});

describe("supervised prefill + confirm", () => {
  it("supervised run prefills criteria + outcome; confirm → human decision + aiRunRef", async () => {
    // 232-12 H-5: supervised prefill needs a calibrated threshold —
    // mode alone is no longer enough (fail-closed gate).
    await ai.upsertPolicy("review_assist", {
      mode: "supervised",
      confidenceThreshold: 0.5,
      updatedBy: "op",
    });
    const rec = await seedCase("rv_s1");
    const run = await appendAssistRun(rec.id, "supervised");
    const { html } = await getHtml(`/admin/review-center/reviews/${rec.id}`);
    expect(html).toContain("supervised — AI prefilled");
    expect(html).toContain(`value="${run.id}"`);
    // prefilled selects: accuracy→PASS, completeness→FAIL, outcome→APPROVED_WITH_NOTES
    expect(html).toContain('value="PASS" selected');
    expect(html).toContain('value="FAIL" selected');
    expect(html).toContain('value="APPROVED_WITH_NOTES" selected');

    const r = await post(
      `/admin/review-center/reviews/${rec.id}/decide`,
      new URLSearchParams({
        formToken: tokenOf(html),
        aiRunRef: run.id,
        crit_accuracy: "PASS",
        crit_completeness: "FAIL",
        outcome: "APPROVED_WITH_NOTES",
        summary: "looks good, add a note",
      }),
    );
    expect(r.status).toBe(303);
    const d = (await reviews.listDecisions(rec.id))[0]!;
    expect(d.decidedBy).not.toBe("AI");
    expect(d.aiRunRef).toBe(run.id);
  });

  it("low-confidence run → 'human required', no prefills", async () => {
    await ai.upsertPolicy("review_assist", {
      mode: "supervised",
      confidenceThreshold: 0.95,
      updatedBy: "op",
    });
    const rec = await seedCase("rv_s2");
    await appendAssistRun(rec.id, "supervised", 0.4);
    const { html } = await getHtml(`/admin/review-center/reviews/${rec.id}`);
    expect(html).toContain("human required");
    expect(html).not.toContain("AI prefilled");
    expect(html).not.toContain('value="APPROVED_WITH_NOTES" selected');
  });
});

describe("reject-suggestion", () => {
  it("records INTERNAL rejection event + form reverts to manual", async () => {
    const rec = await seedCase("rv_s3");
    const run = await appendAssistRun(rec.id, "supervised");
    const { html } = await getHtml(`/admin/review-center/reviews/${rec.id}`);
    const r = await post(
      `/admin/review-center/reviews/${rec.id}/reject-suggestion`,
      new URLSearchParams({
        formToken: tokenOf(html),
        aiRunRef: run.id,
        reason: "criteria wrong",
      }),
    );
    expect(r.status).toBe(303);
    const events = await reviews.listEvents(rec.id);
    const rej = events.find((e) => e.kind === "review.ai_suggestion_rejected")!;
    expect(rej.visibility).toBe("INTERNAL");
    expect((rej.payload as { runId?: string }).runId).toBe(run.id);

    // after rejection the form is fully manual — no prefill, no hidden ref
    const after = await getHtml(`/admin/review-center/reviews/${rec.id}`);
    expect(after.html).not.toContain("AI prefilled");
    expect(after.html).not.toContain(`value="${run.id}"`);

    // a normal human decision still lands — no aiRunRef linkage
    const d = await post(
      `/admin/review-center/reviews/${rec.id}/decide`,
      new URLSearchParams({
        formToken: tokenOf(after.html),
        crit_accuracy: "FAIL",
        crit_completeness: "NA",
        outcome: "REJECTED",
        summary: "not acceptable",
      }),
    );
    expect(d.status).toBe(303);
    const dec = (await reviews.listDecisions(rec.id))[0]!;
    expect(dec.aiRunRef).toBeNull();
  });
});

describe("queue AI lane", () => {
  it("distinguishes needs-confirm / ai-suggested / manual by modeAtTime", async () => {
    const a = await seedCase("rv_q1");
    const b = await seedCase("rv_q2");
    await seedCase("rv_q3");
    await appendAssistRun(a.id, "supervised");
    await appendAssistRun(b.id, "assist");
    const { html } = await getHtml(
      "/admin/review-center?queue=reviews&status=all",
    );
    const rowOf = (id: string) => {
      const i = html.indexOf(id);
      return html.slice(i, html.indexOf("</tr>", i));
    };
    expect(rowOf("rv_q1")).toContain("needs confirm");
    expect(rowOf("rv_q2")).toContain("ai suggested");
    expect(rowOf("rv_q3")).toContain("manual");
  });
});
