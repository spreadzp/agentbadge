/**
 * SLICE-232-7 (E6, D-232-4): review_assist — advisory criteria
 * scoring on review_case; aiRunRef on ReviewDecision is only ever
 * set through the human decide path; AI can't write decisions.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import { createMemoryReviewStores } from "../../src/server/lib/reviews/db-stores";
import type { ReviewStore } from "../../src/server/lib/reviews/store";
import { decideReview } from "../../src/server/lib/reviews/decide";
import { claimReview } from "../../src/server/lib/reviews/workflow";
import { emitReviewHooks, buildReviewEvent } from "../../src/server/lib/reviews/events";

import { registerAiReviewHook, resetAiFeedbackHooks } from "../../src/server/lib/ai/feedback-intake";
import { enqueueAiJob } from "../../src/server/lib/ai/jobs";
import { resetPromptCache } from "../../src/server/lib/ai/prompts";
import type { LlmProvider } from "../../src/server/lib/ai/provider";
import { resetScenarioRunners } from "../../src/server/lib/ai/scenarios";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import { drainAiJobs } from "../../src/server/lib/ai/worker";
import {
  REVIEW_ASSIST_SCENARIO,
  REVIEW_ASSIST_SUBJECT,
  registerReviewAssistRunner,
} from "../../src/server/lib/ai/review-runner";

const CFG: AiEnvConfig = {
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
};

const ASSIST_OUT = {
  criteria: [
    { name: "e2e-flow", passed: true, evidence: "https://ci.example/r1", confidence: 0.9 },
    { name: "auth-flow", passed: false, confidence: 0.6 },
  ],
  recommendation: "CHANGES_REQUESTED",
  confidence: 0.78,
};

let ai: InMemoryAiStore;
let reviews: ReviewStore;

const seedCase = async (id: string) => {
  const { record } = await reviews.submitReview(
    {
      id,
      actorResolution: "did:example:agent",
      dedupeScope: "s",
      reviewType: "INTEGRATION",
      workRef: "bundle://w1",
    },
    [
      {
        id: `${id}_e1`,
        reviewId: id,
        type: "link",
        uri: "https://ci.example/r1",
        label: "ci run",
        submittedBy: "AGENT",
      },
    ],
    [],
  );
  return record;
};

/** Push a case to IN_REVIEW under an assignee (the claim flips it). */
const claimCase = async (id: string, operator: string) => {
  const r = await claimReview(reviews, id, operator);
  expect(r.ok).toBe(true);
};

beforeEach(() => {
  ai = new InMemoryAiStore();
  reviews = createMemoryReviewStores();
  resetScenarioRunners();
  resetAiFeedbackHooks();
  resetPromptCache();
});

describe("review_assist runner (E6)", () => {
  it("review_case intake → job → run with criteria + recommendation", async () => {
    await ai.upsertPolicy(REVIEW_ASSIST_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    await seedCase("rv_a");
    registerReviewAssistRunner({ reviews });

    let user = "";
    const provider: LlmProvider = {
      id: "stub",
      complete: async (req) => {
        user = req.user;
        return {
          text: JSON.stringify(ASSIST_OUT),
          usage: { total: 4 },
          model: "m",
        };
      },
    };
    await enqueueAiJob(ai, {
      scenario: REVIEW_ASSIST_SCENARIO,
      subjectType: REVIEW_ASSIST_SUBJECT,
      subjectId: "rv_a",
      inputRef: "review_case:rv_a",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(res.errors).toEqual([]);
    expect(res.succeeded).toBe(1);
    // platform template + evidence joined into the prompt
    expect(user).toContain("platform criteria template:");
    expect(user).toContain("https://ci.example/r1");

    const run = await ai.latestRunFor(
      REVIEW_ASSIST_SUBJECT,
      "rv_a",
      REVIEW_ASSIST_SCENARIO,
    );
    expect(run!.status).toBe("success");
    expect((run!.output as typeof ASSIST_OUT).recommendation).toBe(
      "CHANGES_REQUESTED",
    );
  });

  it("review.submitted INTERNAL → enqueues review_assist + feedback_extract", async () => {
    for (const s of [REVIEW_ASSIST_SCENARIO, "feedback_extract"]) {
      await ai.upsertPolicy(s, { mode: "shadow", updatedBy: "op" });
    }
    registerAiReviewHook({ aiStore: ai, config: () => CFG });
    emitReviewHooks("rv_ev2", [
      buildReviewEvent("review.submitted", "INTERNAL", { reviewId: "rv_ev2" }),
    ]);
    await new Promise((r) => setTimeout(r, 15));
    for (const s of [REVIEW_ASSIST_SCENARIO, "feedback_extract"]) {
      const dup = await enqueueAiJob(ai, {
        scenario: s,
        subjectType: REVIEW_ASSIST_SUBJECT,
        subjectId: "rv_ev2",
      });
      expect(dup.duplicate).toBe(true); // the hook queued it
    }
  });

  it("reviews:null → seam_unavailable skip, zero calls", async () => {
    await ai.upsertPolicy(REVIEW_ASSIST_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    registerReviewAssistRunner({ reviews: null });
    let calls = 0;
    const provider: LlmProvider = {
      id: "s",
      complete: async () => {
        calls++;
        return { text: "{}", usage: { total: 1 }, model: "m" };
      },
    };
    await enqueueAiJob(ai, {
      scenario: REVIEW_ASSIST_SCENARIO,
      subjectType: REVIEW_ASSIST_SUBJECT,
      subjectId: "rv_x",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(calls).toBe(0);
    expect(res.skipped).toBe(1);
  });
});

describe("D-232-4 boundary — aiRunRef is human-path only", () => {
  it("human decide with aiRunRef → decision row links the run", async () => {
    const rec = await seedCase("rv_d");
    await claimCase(rec.id, "op-1");
    const run = await ai.appendRun({
      scenario: REVIEW_ASSIST_SCENARIO,
      subjectType: REVIEW_ASSIST_SUBJECT,
      subjectId: rec.id,
      modeAtTime: "assist",
      status: "success",
      output: ASSIST_OUT,
    });
    const r = await decideReview(
      reviews,
      rec.id,
      {
        outcome: "CHANGES_REQUESTED",
        summary: "fix the auth flow",
        criteriaResults: [
          { key: "e2e-flow", result: "PASS" },
          { key: "auth-flow", result: "FAIL", note: "missing" },
          { key: "error-handling", result: "PASS" },
          { key: "edge-cases", result: "NA" },
        ],
        aiRunRef: run.id,
      },
      "op-1",
      { aiStore: ai },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.decision.decidedBy).toBe("op-1");
      expect(r.decision.aiRunRef).toBe(run.id);
    }
    const stored = (await reviews.listDecisions(rec.id))[0]!;
    expect(stored.aiRunRef).toBe(run.id);
  });

  it("no aiRunRef → decision.aiRunRef null; decidedBy stays human", async () => {
    const rec = await seedCase("rv_d2");
    await claimCase(rec.id, "op-1");
    const r = await decideReview(
      reviews,
      rec.id,
      {
        outcome: "REJECTED",
        summary: "no",
        criteriaResults: [
          { key: "e2e-flow", result: "FAIL" },
          { key: "auth-flow", result: "FAIL" },
          { key: "error-handling", result: "FAIL" },
          { key: "edge-cases", result: "NA" },
        ],
      },
      "op-1",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decision.aiRunRef).toBeNull();
  });
});
