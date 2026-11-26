/**
 * SLICE-232-4 (E3): knowledge_search runner — LLM reformulation +
 * candidate ranking over the 229 store; NOT_AVAILABLE degrade when
 * the seam is absent; suggestions only (no writes to knowledge).
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import {
  createMemoryRequestInboxStores,
  type RequestInboxStores,
} from "../../src/server/lib/request-inbox";
import { createMemoryKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import type { KnowledgeStore } from "../../src/server/lib/knowledge/store";

import {
  enqueueAiIntakeJobs,
  loadAiSuggestions,
  registerAiIntakeHook,
  resetAiIntakeHook,
} from "../../src/server/lib/ai/intake";
import {
  KNOWLEDGE_SEARCH_SCENARIO,
  registerKnowledgeSearchRunner,
} from "../../src/server/lib/ai/knowledge-runner";
import { resetPromptCache } from "../../src/server/lib/ai/prompts";
import type { LlmProvider } from "../../src/server/lib/ai/provider";
import {
  getScenarioRunner,
  isNotAvailable,
  resetScenarioRunners,
} from "../../src/server/lib/ai/scenarios";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import { drainAiJobs } from "../../src/server/lib/ai/worker";
import { buildEvent, emitInteractionHooks } from "../../src/server/lib/agent-interaction/events";

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
    subjectDailyCallLimit: 0,
};

const FP = { ip: null, ua: null, referer: null, src: null, headers: {} };

const SEARCH_OUT = {
  query: "x402 payment integration",
  matchedEntryIds: ["ki_1"],
  // 232-12: scores ship as [{id, relevance}] rows — strict
  // structured-output providers reject map-shaped properties.
  scores: [{ id: "ki_1", relevance: 0.92 }],
  confidence: 0.85,
};

let ai: InMemoryAiStore;
let inbox: RequestInboxStores;
let knowledge: KnowledgeStore;

const seedRequest = (id: string, text: string) =>
  inbox.requests.submit({
    id,
    state: "submitted",
    kind: "question",
    payload: { text },
    fingerprint: FP,
    fpHash: "f",
    expiresAtMs: Date.now() + 60_000,
  });

const seedKnowledgeItem = async (id: string, title: string, body: string) => {
  const { item } = await knowledge.createItemWithVersion(
    { id, slug: `s-${id}`, kind: "guide", createdBy: "t" },
    { id: `${id}_v1`, itemId: id, seq: 1, title, body, createdBy: "t" },
    { id: `${id}_ev`, itemId: id, from: null, to: "DRAFT", actor: "t" },
  );
  // Publish path: evidence is REQUIRED for VERIFIED; expectedVersionId
  // CAS + distinct actors (SoD) for VERIFIED/PUBLISHED.
  await knowledge.addEvidence({
    id: `${id}_evi`,
    versionId: `${id}_v1`,
    type: "doc",
    uri: `https://docs.example/${id}`,
    addedBy: "t",
  });
  await knowledge.transitionItem(item.id, {
    from: "DRAFT",
    to: "PENDING",
    actor: "t",
  });
  await knowledge.transitionItem(item.id, {
    from: "PENDING",
    to: "VERIFIED",
    actor: "verifier",
    expectedVersionId: `${id}_v1`,
    expectedEvidence: `${id}_evi`,
  });
  await knowledge.transitionItem(item.id, {
    from: "VERIFIED",
    to: "PUBLISHED",
    actor: "publisher",
    expectedVersionId: `${id}_v1`,
  });
  return item;
};

beforeEach(() => {
  ai = new InMemoryAiStore();
  inbox = createMemoryRequestInboxStores();
  knowledge = createMemoryKnowledgeStores();
  resetScenarioRunners();
  resetAiIntakeHook();
  resetPromptCache();
});

describe("knowledge_search runner (E3)", () => {
  it("job → run success with {query, matchedEntryIds, relevanceScores, confidence}", async () => {
    await ai.upsertPolicy(KNOWLEDGE_SEARCH_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    await seedKnowledgeItem("ki_1", "x402 payments guide", "pay with x402 headers");
    await seedRequest("ireq_ks", "how do I pay with x402?");
    registerKnowledgeSearchRunner({ stores: inbox, knowledge });

    let calls = 0;
    const provider: LlmProvider = {
      id: "stub",
      complete: async (req) => {
        calls++;
        expect(req.user).toContain("ki_1");
        expect(req.user).toContain("x402 payments guide");
        return { text: JSON.stringify(SEARCH_OUT), usage: { total: 5 }, model: "m" };
      },
    };
    const { job } = await ai.enqueueJob({
      scenario: KNOWLEDGE_SEARCH_SCENARIO,
      subjectType: "agent_request",
      subjectId: "ireq_ks",
      inputRef: "interaction:ireq_ks",
      inputHash: "h1",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(res.errors).toEqual([]);
    expect(res.succeeded).toBe(1);
    expect(calls).toBe(1);

    const run = await ai.latestRunFor(
      "agent_request",
      "ireq_ks",
      KNOWLEDGE_SEARCH_SCENARIO,
    );
    expect(run!.status).toBe("success");
    expect(run!.output).toEqual(SEARCH_OUT);
    // 232-12 M-5: the recorded version covers system text + the
    // output contract — recompute the combined hash.
    const rp = await getScenarioRunner(KNOWLEDGE_SEARCH_SCENARIO)!({
      job: job!,
      store: ai,
    });
    if (isNotAvailable(rp)) throw new Error("unexpected notAvailable");
    expect(run!.promptVersion).toBe(rp.promptVersion);
    const j = await ai.getJob(job.id);
    expect(j!.status).toBe("done");
  });

  it("NOT_AVAILABLE degrade: knowledge=null → skipped run, zero provider calls", async () => {
    await ai.upsertPolicy(KNOWLEDGE_SEARCH_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    await seedRequest("ireq_nok", "find docs");
    registerKnowledgeSearchRunner({ stores: inbox, knowledge: null });

    let calls = 0;
    const provider: LlmProvider = {
      id: "stub",
      complete: async () => {
        calls++;
        return { text: "{}", usage: { total: 1 }, model: "m" };
      },
    };
    await ai.enqueueJob({
      scenario: KNOWLEDGE_SEARCH_SCENARIO,
      subjectType: "agent_request",
      subjectId: "ireq_nok",
      inputRef: "interaction:ireq_nok",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(res.skipped).toBe(1);
    expect(calls).toBe(0);
    const run = await ai.latestRunFor(
      "agent_request",
      "ireq_nok",
      KNOWLEDGE_SEARCH_SCENARIO,
    );
    expect(run!.status).toBe("skipped");
    expect(run!.error).toContain("seam_unavailable: knowledge_store");
  });
});

describe("intake + suggestions integration", () => {
  it("intake event enqueues knowledge_search when policy≠off; suggestion renders output", async () => {
    await ai.upsertPolicy(KNOWLEDGE_SEARCH_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    registerAiIntakeHook({ aiStore: ai, config: () => CFG });
    emitInteractionHooks("ireq_ks2", [
      buildEvent("interaction.request.received", "INTERNAL", {
        requestId: "ireq_ks2",
        payloadSha256: "snap-ks2",
      }),
    ]);
    await new Promise((r) => setTimeout(r, 15));
    // hook fired → re-enqueue dedupes (idempotency key)
    const res = await enqueueAiIntakeJobs(ai, { requestId: "ireq_ks2" });
    const ksJob = res.find((r) => r.scenario === KNOWLEDGE_SEARCH_SCENARIO)!;
    expect(ksJob.duplicate).toBe(true);

    // suggestion view-model picks the scenario up once a run exists
    await ai.appendRun({
      scenario: KNOWLEDGE_SEARCH_SCENARIO,
      subjectType: "agent_request",
      subjectId: "ireq_ks2",
      modeAtTime: "assist",
      status: "success",
      output: SEARCH_OUT,
      confidence: 0.85,
    });
    const views = await loadAiSuggestions(ai, "ireq_ks2");
    const ks = views.find((v) => v.scenario === KNOWLEDGE_SEARCH_SCENARIO)!;
    expect(ks.status).toBe("success");
    expect((ks.output as typeof SEARCH_OUT).matchedEntryIds).toEqual(["ki_1"]);
  });

  it("mode gating: policy off → intake enqueues nothing for the scenario", async () => {
    // knowledge_search policy absent → mode off → no job
    await ai.upsertPolicy("classification", { mode: "assist", updatedBy: "op" });
    registerAiIntakeHook({ aiStore: ai, config: () => CFG });
    emitInteractionHooks("ireq_ksoff", [
      buildEvent("interaction.request.received", "INTERNAL", {
        requestId: "ireq_ksoff",
        payloadSha256: "h",
      }),
    ]);
    await new Promise((r) => setTimeout(r, 15));
    // knowledge_search policy absent → off → hook skipped it: a manual
    // enqueue lands fresh (not a duplicate) — nothing was queued.
    const res = await enqueueAiIntakeJobs(ai, { requestId: "ireq_ksoff" });
    expect(
      res.find((r) => r.scenario === KNOWLEDGE_SEARCH_SCENARIO),
    ).toBeUndefined();
  });

  it("read-only: runner never calls knowledge mutations (D-228-7)", async () => {
    await ai.upsertPolicy(KNOWLEDGE_SEARCH_SCENARIO, {
      mode: "assist",
      updatedBy: "op",
    });
    await seedRequest("ireq_ro", "docs on payments?");
    // 232-12 H-3: ki_1 must be a real candidate — the runner now
    // rejects ids it never showed the model.
    await seedKnowledgeItem("ki_1", "payments docs", "pay with x402 headers");
    const guarded = new Proxy(knowledge, {
      get(t, prop) {
        const v = (t as never)[prop];
        if (
          typeof prop === "string" &&
          /^(create|add|remove|transition|upsert|link|unlink|record|assign|append|mark)/.test(prop)
        ) {
          throw new Error(`knowledge write attempted: ${prop}`);
        }
        return typeof v === "function"
          ? (v as (...a: unknown[]) => unknown).bind(t)
          : v;
      },
    });
    registerKnowledgeSearchRunner({ stores: inbox, knowledge: guarded });
    const provider: LlmProvider = {
      id: "stub",
      complete: async () => ({
        text: JSON.stringify(SEARCH_OUT),
        usage: { total: 1 },
        model: "m",
      }),
    };
    await ai.enqueueJob({
      scenario: KNOWLEDGE_SEARCH_SCENARIO,
      subjectType: "agent_request",
      subjectId: "ireq_ro",
      inputRef: "interaction:ireq_ro",
    });
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(res.succeeded).toBe(1); // no write attempted → no fault
  });
});
