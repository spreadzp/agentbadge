/**
 * SLICE-232-6 (E5): feedback_extract scenario — structured
 * suggestions/issues/topics from feedback + review subjects over the
 * 230 seam; NOT_AVAILABLE degrade; zero auto-created domain records.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import { createMemoryFeedbackStores } from "../../src/server/lib/feedback/db-stores";
import { createMemoryReviewStores } from "../../src/server/lib/reviews/db-stores";
import type { FeedbackStore } from "../../src/server/lib/feedback/store";
import type { ReviewStore } from "../../src/server/lib/reviews/store";
import {
  buildFeedbackEvent,
  emitFeedbackHooks,
} from "../../src/server/lib/feedback/events";
import {
  buildReviewEvent,
  emitReviewHooks,
} from "../../src/server/lib/reviews/events";

import {
  registerAiFeedbackHook,
  registerAiReviewHook,
  resetAiFeedbackHooks,
} from "../../src/server/lib/ai/feedback-intake";
import {
  FEEDBACK_EXTRACT_SCENARIO,
  registerFeedbackExtractRunner,
} from "../../src/server/lib/ai/feedback-runner";
import { enqueueAiJob } from "../../src/server/lib/ai/jobs";
import { resetPromptCache } from "../../src/server/lib/ai/prompts";
import type { LlmProvider } from "../../src/server/lib/ai/provider";
import {
  getScenarioRunner,
  resetScenarioRunners,
} from "../../src/server/lib/ai/scenarios";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import { drainAiJobs } from "../../src/server/lib/ai/worker";

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

const EXTRACT_OUT = {
  items: [
    {
      type: "issue",
      text: "x402 checkout fails on Safari",
      sentiment: "negative",
      confidence: 0.9,
    },
    {
      type: "suggestion",
      text: "Document the retry semantics",
      sentiment: "neutral",
      confidence: 0.7,
    },
  ],
  overallConfidence: 0.82,
};

let ai: InMemoryAiStore;
let feedback: FeedbackStore;
let reviews: ReviewStore;

const seedFeedback = (id: string, text: string) =>
  feedback.submitFeedback(
    {
      id,
      actorResolution: "did:example:agent",
      dedupeScope: "s",
      text,
      kind: "BUG",
      target: "api",
      normalized: `n-${id}`,
    },
    [],
  );

const seedReview = async (id: string) => {
  const { record } = await reviews.submitReview(
    {
      id,
      actorResolution: "did:example:agent",
      dedupeScope: "s",
      reviewType: "integration",
      workRef: "bundle://w1",
      agentCriteria: { mustPass: ["probe"] },
    },
    [
      {
        id: `${id}_e1`,
        reviewId: id,
        type: "link",
        uri: "https://ci.example/run/1",
        label: "ci run",
        description: "probe failed twice",
        submittedBy: "AGENT",
      },
    ],
    [],
  );
  return record;
};

const stubProvider = (out: unknown): LlmProvider => ({
  id: "stub",
  complete: async () => ({
    text: JSON.stringify(out),
    usage: { total: 1 },
    model: "m",
  }),
});

beforeEach(() => {
  ai = new InMemoryAiStore();
  feedback = createMemoryFeedbackStores();
  reviews = createMemoryReviewStores();
  resetScenarioRunners();
  resetAiFeedbackHooks();
  resetPromptCache();
});

describe("feedback_extract runner (E5)", () => {
  it("feedback subject → run success with items[] + overallConfidence", async () => {
    await ai.upsertPolicy(FEEDBACK_EXTRACT_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    await seedFeedback("fb_1", "x402 checkout is broken on Safari — please fix and document retries");
    registerFeedbackExtractRunner({ feedback, reviews });

    let user = "";
    const provider: LlmProvider = {
      id: "stub",
      complete: async (req) => {
        user = req.user;
        return {
          text: JSON.stringify(EXTRACT_OUT),
          usage: { total: 3 },
          model: "m",
        };
      },
    };
    const { job } = await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "feedback",
      subjectId: "fb_1",
      inputRef: "feedback:fb_1",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(res.errors).toEqual([]);
    expect(res.succeeded).toBe(1);
    expect(user).toContain("x402 checkout is broken on Safari");
    expect(user).toContain("kind: BUG");

    const run = await ai.latestRunFor(
      "feedback",
      "fb_1",
      FEEDBACK_EXTRACT_SCENARIO,
    );
    expect(run!.status).toBe("success");
    expect(run!.output).toEqual(EXTRACT_OUT);
    const j = await ai.getJob(job!.id);
    expect(j!.status).toBe("done");
  });

  it("review_case subject → prompt carries case fields + evidence", async () => {
    await ai.upsertPolicy(FEEDBACK_EXTRACT_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    const rec = await seedReview("rv_1");
    registerFeedbackExtractRunner({ feedback, reviews });
    const runner = getScenarioRunner(FEEDBACK_EXTRACT_SCENARIO)!;
    const { job } = await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "review_case",
      subjectId: rec.id,
    });
    const p = await runner({ job: job!, store: ai });
    if ("notAvailable" in p) throw new Error("unexpected notAvailable");
    expect(p.user).toContain("bundle://w1");
    expect(p.user).toContain("ci run");
    expect(p.user).toContain("probe failed twice");
  });

  it("unsupported subjectType → audited runner_fault, not silent", async () => {
    await ai.upsertPolicy(FEEDBACK_EXTRACT_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    registerFeedbackExtractRunner({ feedback, reviews });
    await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "agent_request",
      subjectId: "x1",
    });
    const res = await drainAiJobs({
      store: ai,
      config: CFG,
      provider: stubProvider(EXTRACT_OUT),
    });
    expect(res.succeeded).toBe(0);
    expect(res.errors[0]).toContain("unsupported_subject");
  });
});

describe("230 seam degrade (AC#2)", () => {
  it("feedback:null → seam_unavailable skip, zero provider calls", async () => {
    await ai.upsertPolicy(FEEDBACK_EXTRACT_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    registerFeedbackExtractRunner({ feedback: null, reviews: null });
    let calls = 0;
    const provider: LlmProvider = {
      id: "stub",
      complete: async () => {
        calls++;
        return { text: "{}", usage: { total: 1 }, model: "m" };
      },
    };
    await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "feedback",
      subjectId: "fb_none",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(calls).toBe(0);
    expect(res.skipped).toBe(1);
    const run = await ai.latestRunFor(
      "feedback",
      "fb_none",
      FEEDBACK_EXTRACT_SCENARIO,
    );
    expect(run!.error).toContain("seam_unavailable: feedback_store");
  });
});

describe("intake hooks + gating", () => {
  it("INTERNAL feedback.received + review.submitted → jobs; mode off → none", async () => {
    await ai.upsertPolicy(FEEDBACK_EXTRACT_SCENARIO, {
      mode: "shadow",
      updatedBy: "op",
    });
    registerAiFeedbackHook({ aiStore: ai, config: () => CFG });
    registerAiReviewHook({ aiStore: ai, config: () => CFG });

    emitFeedbackHooks("fb_ev", [
      buildFeedbackEvent("feedback.received", "INTERNAL", {
        feedbackId: "fb_ev",
        text: "checkout is broken",
      }),
    ]);
    emitReviewHooks("rv_ev", [
      buildReviewEvent("review.submitted", "INTERNAL", {
        reviewId: "rv_ev",
        workRef: "bundle://w",
      }),
    ]);
    await new Promise((r) => setTimeout(r, 15));
    // hook queued → same derived idempotency key dedupes
    const fbDup = await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "feedback",
      subjectId: "fb_ev",
    });
    const rvDup = await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "review_case",
      subjectId: "rv_ev",
    });
    expect(fbDup.duplicate).toBe(true);
    expect(rvDup.duplicate).toBe(true);
  });

  it("policy off → neither hook queues; PUBLIC events ignored", async () => {
    registerAiFeedbackHook({ aiStore: ai, config: () => CFG });
    emitFeedbackHooks("fb_off", [
      buildFeedbackEvent("feedback.received", "INTERNAL", { text: "t" }),
      buildFeedbackEvent("feedback.received", "PUBLIC", { text: "t" }),
    ]);
    await new Promise((r) => setTimeout(r, 15));
    const probe = await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "feedback",
      subjectId: "fb_off",
    });
    expect(probe.duplicate).toBe(false); // hook never queued it
  });
});

describe("extraction ≠ entry (AC#3)", () => {
  it("runner never mutates the 230 stores — no auto-created Feedback", async () => {
    await ai.upsertPolicy(FEEDBACK_EXTRACT_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    await seedFeedback("fb_ro", "read me only");
    const MUTATING =
      /^(submit|transition|append|mark|add|remove|record|create)/;
    const guard = <T extends object>(store: T): T =>
      new Proxy(store, {
        get(t, prop) {
          const v = (t as never)[prop];
          if (typeof prop === "string" && MUTATING.test(prop)) {
            throw new Error(`domain write attempted: ${prop}`);
          }
          return typeof v === "function"
            ? (v as (...a: unknown[]) => unknown).bind(t)
            : v;
        },
      });
    registerFeedbackExtractRunner({
      feedback: guard(feedback),
      reviews: guard(reviews),
    });
    await enqueueAiJob(ai, {
      scenario: FEEDBACK_EXTRACT_SCENARIO,
      subjectType: "feedback",
      subjectId: "fb_ro",
    });
    const res = await drainAiJobs({
      store: ai,
      config: CFG,
      provider: stubProvider(EXTRACT_OUT),
    });
    expect(res.succeeded).toBe(1);
    expect(await feedback.listFeedback()).toHaveLength(1); // seed only
  });
});
