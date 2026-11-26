/**
 * SLICE-232-12 (GATE): per-finding regression block for the Arc
 * audit of EPIC-232 — each fix gets a test that fails on the
 * pre-fix behaviour. Findings doc:
 * docs/EPICS/232-ai-review-automation/reviews/REVIEW-FINDINGS-232.md
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import { checkBudget, resolveEffectiveMode } from "../../src/server/lib/ai/budget";
import {
  registerAiComparisonHook,
  resetAiComparisonHook,
} from "../../src/server/lib/ai/compare";
import { humanOutcomeFor } from "../../src/server/lib/ai/comparators";
import { enqueueAiJob } from "../../src/server/lib/ai/jobs";
import {
  sanitizeUntrusted,
  untrustedBlock,
  UNTRUSTED_RULE,
} from "../../src/server/lib/ai/intake-runners";
import { validateScenarioOutput } from "../../src/server/lib/ai/output-schemas";
import { resetPromptCache } from "../../src/server/lib/ai/prompts";
import { registerKnowledgeSearchRunner } from "../../src/server/lib/ai/knowledge-runner";
import { registerAnswerDraftRunner } from "../../src/server/lib/ai/draft-runner";
import type { LlmProvider } from "../../src/server/lib/ai/provider";
import { resetScenarioRunners } from "../../src/server/lib/ai/scenarios";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import { drainAiJobs } from "../../src/server/lib/ai/worker";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox";
import { createMemoryKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import {
  buildEvent,
  emitInteractionHooks,
} from "../../src/server/lib/agent-interaction/events";
import {
  createMemoryReviewData,
  createMemoryReviewStore,
} from "../../src/server/lib/reviews/store-memory";
import { decideReview } from "../../src/server/lib/reviews/decide";
import { claimReview, rejectAiSuggestion } from "../../src/server/lib/reviews/workflow";

const CFG: AiEnvConfig = {
  enabled: true,
  baseUrl: "https://llm.test",
  apiKey: "k",
  model: "m-1",
  dailyCallLimit: 0,
  monthlyBudgetUsd: 0,
  usdPer1MTokens: 1.0,
  shadowReserveCalls: 0,
  timeoutMs: 5_000,
  retryOnce: false,
  workerEnabled: true,
  workerIntervalMs: 5_000,
  jobLeaseMs: 60_000,
  jobMaxAttempts: 3,
  jobQueueCap: 500,
};

const FP = { ip: null, ua: null, referer: null, src: null, headers: {} };

let ai: InMemoryAiStore;

beforeEach(() => {
  ai = new InMemoryAiStore();
  resetScenarioRunners();
  resetAiComparisonHook();
  resetPromptCache();
});

// ─── C-1: aiRunRef operator-asserted, zero server-side validation ──

describe("C-1: aiRunRef server-side validation", () => {
  const seedCase = async (id: string, operator: string) => {
    const reviews = createMemoryReviewStore(createMemoryReviewData());
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
    const c = await claimReview(reviews, record.id, operator);
    expect(c.ok).toBe(true);
    return reviews;
  };

  const decideInput = {
    outcome: "CHANGES_REQUESTED",
    summary: "needs fixes",
    criteriaResults: [
      { key: "accuracy", result: "FAIL" },
      { key: "completeness", result: "PASS" },
    ],
  };

  it("ref run from a different case / scenario / mode / status → invalid_ai_run_ref", async () => {
    const reviews = await seedCase("rv_c1", "op-1");
    const other = await ai.appendRun({
      scenario: "review_assist",
      subjectType: "review_case",
      subjectId: "rv_OTHER", // different subject
      modeAtTime: "assist",
      status: "success",
      output: {},
    });
    const shadow = await ai.appendRun({
      scenario: "review_assist",
      subjectType: "review_case",
      subjectId: "rv_c1",
      modeAtTime: "shadow", // shadow never endorses
      status: "success",
      output: {},
    });
    const failed = await ai.appendRun({
      scenario: "review_assist",
      subjectType: "review_case",
      subjectId: "rv_c1",
      modeAtTime: "assist",
      status: "error", // failed run
      output: null,
    });
    const wrongScenario = await ai.appendRun({
      scenario: "classification",
      subjectType: "review_case",
      subjectId: "rv_c1",
      modeAtTime: "assist",
      status: "success",
      output: {},
    });

    for (const bad of [other, shadow, failed, wrongScenario]) {
      const r = await decideReview(
        reviews,
        "rv_c1",
        { ...decideInput, aiRunRef: bad.id },
        "op-1",
        { aiStore: ai },
      );
      expect(r).toMatchObject({ ok: false, error: "invalid_ai_run_ref" });
    }
    // and deciding without the aiStore dep refuses rather than trusts
    const noDeps = await decideReview(
      reviews,
      "rv_c1",
      { ...decideInput, aiRunRef: other.id },
      "op-1",
    );
    expect(noDeps).toMatchObject({ ok: false, error: "invalid_ai_run_ref" });
  });

  it("valid run ref links; decidedBy stays the operator", async () => {
    const reviews = await seedCase("rv_c2", "op-1");
    const run = await ai.appendRun({
      scenario: "review_assist",
      subjectType: "review_case",
      subjectId: "rv_c2",
      modeAtTime: "supervised",
      status: "success",
      output: {},
    });
    const r = await decideReview(
      reviews,
      "rv_c2",
      { ...decideInput, aiRunRef: run.id },
      "op-1",
      { aiStore: ai },
    );
    expect(r.ok).toBe(true);
    const d = (await reviews.listDecisions("rv_c2"))[0]!;
    expect(d.aiRunRef).toBe(run.id);
    expect(d.decidedBy).toBe("op-1");
  });

  it("rejectAiSuggestion validates run ref + dedupes the INTERNAL event", async () => {
    const reviews = await seedCase("rv_c3", "op-1");
    const bad = await rejectAiSuggestion(reviews, ai, "rv_c3", "op-1", {
      runId: "airun_ghost",
    });
    expect(bad).toMatchObject({ ok: false, error: "invalid_ai_run_ref" });

    const run = await ai.appendRun({
      scenario: "review_assist",
      subjectType: "review_case",
      subjectId: "rv_c3",
      modeAtTime: "supervised",
      status: "success",
      output: {},
    });
    const first = await rejectAiSuggestion(reviews, ai, "rv_c3", "op-1", {
      runId: run.id,
      reason: "bad evidence",
    });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    const second = await rejectAiSuggestion(reviews, ai, "rv_c3", "op-1", {
      runId: run.id,
    });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    const events = await reviews.listEvents("rv_c3", {
      visibility: "INTERNAL",
    });
    expect(
      events.filter((e) => e.kind === "review.ai_suggestion_rejected"),
    ).toHaveLength(1);
  });
});

// ─── H-4: per-scenario strict output schemas ──────────────────────

describe("H-4: scenario output validation", () => {
  it("malformed outputs rejected; valid pass; confidence bounds enforced", () => {
    expect(
      validateScenarioOutput("classification", { label: "bug" }),
    ).toBeTruthy();
    expect(
      validateScenarioOutput("classification", {
        category: "bug",
        intent: "BUG_REPORT",
        capabilities: [],
        confidence: 1.5, // out of bounds
      }),
    ).toBeTruthy();
    expect(
      validateScenarioOutput("classification", {
        category: "bug",
        intent: "BUG_REPORT",
        capabilities: [],
        confidence: 0.8,
      }),
    ).toBeNull();
    // extra keys rejected (strict)
    expect(
      validateScenarioOutput("answer_draft", {
        draftText: "hi",
        usedKnowledgeIds: [],
        tone: "brief",
        confidence: 0.5,
        smuggled: true,
      }),
    ).toBeTruthy();
  });
});

// ─── H-6: prompt injection — untrusted fencing ────────────────────

describe("H-6: prompt injection hygiene", () => {
  it("untrustedBlock fences + sanitizeUntrusted strips control chars and caps length", () => {
    const fenced = untrustedBlock("hello\x00\x1Fworld");
    expect(fenced).toBe("<untrusted_input>\nhelloworld\n</untrusted_input>");
    expect(sanitizeUntrusted("x".repeat(10_000)).length).toBe(4_000);
    expect(UNTRUSTED_RULE).toContain("<untrusted_input>");
  });
});

// ─── H-7: job claim CAS + max-attempts burn ───────────────────────

describe("H-7: job claim CAS", () => {
  it("attempts >= maxAttempts never reclaimed; stale lock loses CAS", async () => {
    const { job } = await enqueueAiJob(ai, {
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "ireq_cas",
      inputRef: "interaction:ireq_cas",
    });
    const now = new Date().toISOString();
    // claim twice → attempts=2, then burn to max
    const first = await ai.claimJobs({
      limit: 1,
      reclaimBefore: "9999",
      now,
      maxAttempts: 2,
    });
    expect(first).toHaveLength(1);
    const lock1 = first[0]!.lockedAt!;
    const second = await ai.claimJobs({
      limit: 1,
      reclaimBefore: "9999",
      now: new Date(Date.now() + 1).toISOString(),
      maxAttempts: 2,
    });
    expect(second).toHaveLength(1); // reclaimed under new lock
    // attempts=2 == max → never claimable again
    const third = await ai.claimJobs({
      limit: 1,
      reclaimBefore: "9999",
      now: new Date(Date.now() + 2).toISOString(),
      maxAttempts: 2,
    });
    expect(third).toHaveLength(0);
    // stale claim CAS: first claim's lock token is obsolete
    const stale = await ai.completeJob(
      job!.id,
      { status: "done" },
      { expectedLockedAt: lock1 },
    );
    expect(stale).toBeNull();
    const fresh = await ai.completeJob(
      job!.id,
      { status: "done" },
      { expectedLockedAt: second[0]!.lockedAt },
    );
    expect(fresh).not.toBeNull();
  });
});

// ─── H-8: budget meter + queue-depth cap ──────────────────────────

describe("H-8: budget meter counts real calls only; enqueue cap", () => {
  it("pre-provider faults do not burn the daily meter", async () => {
    await ai.appendRun({
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "i1",
      modeAtTime: "assist",
      status: "error",
      error: "no_runner", // never reached the provider
    });
    await ai.appendRun({
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "i2",
      modeAtTime: "assist",
      status: "skipped",
    });
    await ai.appendRun({
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "i3",
      modeAtTime: "assist",
      status: "success", // real provider call
      tokensTotal: 5,
    });
    const b = await checkBudget(ai, { ...CFG, dailyCallLimit: 2 });
    expect(b.dailyCalls).toBe(1);
    expect(b.state).toBe("ok"); // not exhausted by fault rows
  });

  it("queue cap refuses enqueue with an explicit marker", async () => {
    for (let i = 0; i < 3; i++) {
      await ai.enqueueJob({
        scenario: "classification",
        subjectType: "agent_request",
        subjectId: `cap_${i}`,
        inputRef: null,
        idempotencyKey: `k${i}`,
      });
    }
    const res = await enqueueAiJob(
      ai,
      {
        scenario: "classification",
        subjectType: "agent_request",
        subjectId: "cap_over",
        inputRef: null,
      },
      { queueCap: 3 },
    );
    expect(res).toMatchObject({
      job: null,
      duplicate: false,
      refused: "queue_full",
    });
  });
});

// ─── H-9: metrics vocab + dedupe helpers ──────────────────────────

describe("H-9: comparator vocab + compare dedupe", () => {
  it("humanOutcomeFor normalizes AI → human outcome vocabulary", () => {
    expect(humanOutcomeFor("APPROVE")).toBe("APPROVED");
    expect(humanOutcomeFor("APPROVE_WITH_NOTES")).toBe("APPROVED_WITH_NOTES");
    expect(humanOutcomeFor("REJECT")).toBe("REJECTED");
    expect(humanOutcomeFor("other")).toBe("other");
  });

  it("first human outcome wins — re-classify does not re-score a run", async () => {
    const inbox = createMemoryRequestInboxStores();
    await inbox.requests.submit({
      id: "ireq_dedup",
      state: "submitted",
      kind: "question",
      payload: { text: "pay with x402?" },
      fingerprint: FP,
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    const run = await ai.appendRun({
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "ireq_dedup",
      modeAtTime: "shadow",
      status: "success",
      output: {
        category: "question",
        intent: "INTEGRATION_HELP",
        capabilities: [],
        confidence: 0.9,
      },
    });
    const off = registerAiComparisonHook({ aiStore: ai, stores: inbox });
    try {
      const classified = (intent: string) =>
        buildEvent("interaction.request.classified", "INTERNAL", {
          patch: { intent },
        });
      emitInteractionHooks("ireq_dedup", [classified("INTEGRATION_HELP")]);
      await new Promise((r) => setTimeout(r, 50));
      // second classify (operator changed their mind after seeing
      // the shadow answer on the timeline) must NOT re-score
      emitInteractionHooks("ireq_dedup", [classified("OTHER")]);
      await new Promise((r) => setTimeout(r, 50));
      const events = await inbox.interactions.listEvents("ireq_dedup", {
        visibility: "INTERNAL",
      });
      const agreements = events.filter(
        (e) => e.kind === "ai.agreement.computed",
      );
      expect(agreements).toHaveLength(1);
      // and the recorded comparison is the FIRST outcome (blind)
      const payload = agreements[0]!.payload as { runId: string };
      expect(payload.runId).toBe(run.id);
    } finally {
      off();
    }
  });
});

// ─── H-1 + H-3: shadow leak + LLM-chosen knowledge ids ────────────

describe("H-3: knowledge candidate validation", () => {
  it("model citing an id it was never shown → invalid_json run", async () => {
    await ai.upsertPolicy("knowledge_search", {
      mode: "assist",
      updatedBy: "op",
    });
    const inbox = createMemoryRequestInboxStores();
    await inbox.requests.submit({
      id: "ireq_h3",
      state: "submitted",
      kind: "question",
      payload: { text: "docs on payments?" },
      fingerprint: FP,
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    // knowledge store empty → zero candidates → any matched id is
    // one the model invented
    registerKnowledgeSearchRunner({
      stores: inbox,
      knowledge: createMemoryKnowledgeStores(),
    });
    const provider: LlmProvider = {
      id: "stub",
      complete: async () => ({
        text: JSON.stringify({
          query: "payments",
          matchedEntryIds: ["ki_hallucinated"],
          scores: [{ id: "ki_hallucinated", relevance: 0.9 }],
          confidence: 0.8,
        }),
        usage: { total: 3 },
        model: "m",
      }),
    };
    await enqueueAiJob(ai, {
      scenario: "knowledge_search",
      subjectType: "agent_request",
      subjectId: "ireq_h3",
      inputRef: "interaction:ireq_h3",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    // attempt 1 of jobMaxAttempts → job retries; the RUN row is the
    // honest artifact: invalid_json, nothing the model invented
    // reaches a success row.
    expect(res.processed).toBe(1);
    const runs = await ai.listRuns({ subjectId: "ireq_h3" });
    expect(runs[0]!.status).toBe("invalid_json");
    expect(runs[0]!.error).toContain("unknown");
  });
});

// ─── H-1: draft-runner picks a shadow knowledge_search run ────────

describe("H-1: draft hydration ignores shadow runs", () => {
  it("shadow knowledge_search run's picks never hydrate into the draft prompt", async () => {
    await ai.upsertPolicy("answer_draft", {
      mode: "assist",
      updatedBy: "op",
    });
    const inbox = createMemoryRequestInboxStores();
    await inbox.requests.submit({
      id: "ireq_h1",
      state: "submitted",
      kind: "question",
      payload: { text: "how do refunds work?" },
      fingerprint: FP,
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    // shadow run picked a knowledge id — invisible to operators, so
    // its picks must not leak into the visible draft prompt.
    await ai.appendRun({
      scenario: "knowledge_search",
      subjectType: "agent_request",
      subjectId: "ireq_h1",
      modeAtTime: "shadow",
      status: "success",
      output: {
        query: "refunds",
        matchedEntryIds: ["ki_shadow_pick"],
        scores: [{ id: "ki_shadow_pick", relevance: 0.9 }],
        confidence: 0.9,
      },
    });
    registerAnswerDraftRunner({
      inbox,
      knowledge: createMemoryKnowledgeStores(),
    });
    let seenUser = "";
    const provider: LlmProvider = {
      id: "stub",
      complete: async (req) => {
        seenUser = req.user;
        return {
          text: JSON.stringify({
            draftText: "advisory reply",
            usedKnowledgeIds: [],
            tone: "brief",
            confidence: 0.6,
          }),
          usage: { total: 3 },
          model: "m",
        };
      },
    };
    await enqueueAiJob(ai, {
      scenario: "answer_draft",
      subjectType: "agent_request",
      subjectId: "ireq_h1",
      inputRef: "interaction:ireq_h1",
    });
    await drainAiJobs({ store: ai, config: CFG, provider });
    expect(seenUser).toContain("no knowledge base excerpts matched");
    expect(seenUser).not.toContain("ki_shadow_pick");
  });
});

// ─── H-5: render-time effective mode ──────────────────────────────

describe("H-5: effective mode resolution", () => {
  it("kill switch + budget exhaustion resolve any declared mode to off", () => {
    expect(
      resolveEffectiveMode("supervised", {
        enabled: false,
        budget: "ok",
      }),
    ).toBe("off");
    expect(
      resolveEffectiveMode("supervised", {
        enabled: true,
        budget: "exhausted",
      }),
    ).toBe("off");
    expect(
      resolveEffectiveMode("shadow", {
        enabled: true,
        budget: "shadow_cut",
      }),
    ).toBe("off");
    expect(
      resolveEffectiveMode("assist", {
        enabled: true,
        budget: "shadow_cut",
      }),
    ).toBe("assist");
  });
});
