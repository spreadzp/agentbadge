/**
 * SLICE-232-5 (E4, D-232-3): answer_draft — advisory draft reply on
 * agent_request; consumes knowledge_search output when present (E3
 * link); editable suggestion only — no auto-send path exists.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import { createAgentInteractionAdminUi } from "../../src/server/routes/agent-interaction/agent-interaction-admin-ui";
import {
  createMemoryRequestInboxStores,
  type RequestInboxStores,
} from "../../src/server/lib/request-inbox";
import { createMemoryKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import type { KnowledgeStore } from "../../src/server/lib/knowledge/store";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

import { registerAnswerDraftRunner } from "../../src/server/lib/ai/draft-runner";
import { enqueueAiIntakeJobs } from "../../src/server/lib/ai/intake";
import { enqueueAiJob } from "../../src/server/lib/ai/jobs";
import { resetPromptCache } from "../../src/server/lib/ai/prompts";
import type { LlmProvider } from "../../src/server/lib/ai/provider";
import { resetScenarioRunners } from "../../src/server/lib/ai/scenarios";
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
};

const FP = { ip: null, ua: null, referer: null, src: null, headers: {} };
const DRAFT_OUT = {
  draftText: "You can pay via the x402 flow — see the attached steps.",
  usedKnowledgeIds: ["ki_1"],
  tone: "brief",
  confidence: 0.72,
};

let ai: InMemoryAiStore;
let inbox: RequestInboxStores;
let knowledge: KnowledgeStore;

const seedRequest = async (id: string, text = "how do I pay with x402?") =>
  (
    await inbox.requests.submit({
      id,
      state: "submitted",
      payload: { text },
      fingerprint: FP,
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    })
  ).record;

const stubProvider = (capture: { user?: string } = {}): LlmProvider => ({
  id: "stub",
  complete: async (req) => {
    capture.user = req.user;
    return {
      text: JSON.stringify(DRAFT_OUT),
      usage: { total: 5 },
      model: "m",
    };
  },
});

beforeEach(() => {
  ai = new InMemoryAiStore();
  inbox = createMemoryRequestInboxStores();
  knowledge = createMemoryKnowledgeStores();
  resetScenarioRunners();
  resetPromptCache();
});

describe("answer_draft runner", () => {
  it("job → run with {draftText, usedKnowledgeIds, tone, confidence}", async () => {
    await ai.upsertPolicy("answer_draft", { mode: "assist", updatedBy: "op" });
    const rec = await seedRequest("ireq_d1");
    registerAnswerDraftRunner({ inbox, knowledge });
    const cap: { user?: string } = {};
    await enqueueAiJob(ai, {
      scenario: "answer_draft",
      subjectType: "agent_request",
      subjectId: rec.id,
    });
    const res = await drainAiJobs({
      store: ai,
      config: CFG,
      provider: stubProvider(cap),
    });
    expect(res.errors).toEqual([]);
    const run = await ai.latestRunFor("agent_request", rec.id, "answer_draft");
    expect(run!.status).toBe("success");
    expect((run!.output as typeof DRAFT_OUT).tone).toBe("brief");
    expect(cap.user).toContain("how do I pay with x402?");
    expect(cap.user).toContain("(no knowledge base excerpts matched");
  });

  it("consumes E3 output — knowledge_search run hydrates excerpts", async () => {
    await ai.upsertPolicy("answer_draft", { mode: "assist", updatedBy: "op" });
    const rec = await seedRequest("ireq_d2");
    const { item } = await knowledge.createItemWithVersion(
      { id: "ki_1", slug: "s-ki_1", kind: "guide", createdBy: "t" },
      {
        id: "ki_1_v1",
        itemId: "ki_1",
        seq: 1,
        title: "x402 payments guide",
        body: "Pay with x402 headers then poll the receipt endpoint.",
        createdBy: "t",
      },
      { id: "ki_1_ev", itemId: "ki_1", from: null, to: "DRAFT", actor: "t" },
    );
    await ai.appendRun({
      scenario: "knowledge_search",
      subjectType: "agent_request",
      subjectId: rec.id,
      modeAtTime: "assist",
      status: "success",
      output: {
        query: "x402 payment",
        matchedEntryIds: [item.id],
        relevanceScores: { [item.id]: 0.9 },
        confidence: 0.8,
      },
    });
    registerAnswerDraftRunner({ inbox, knowledge });
    const cap: { user?: string } = {};
    await enqueueAiJob(ai, {
      scenario: "answer_draft",
      subjectType: "agent_request",
      subjectId: rec.id,
    });
    await drainAiJobs({ store: ai, config: CFG, provider: stubProvider(cap) });
    expect(cap.user).toContain("x402 payments guide");
    expect(cap.user).toContain("knowledge base excerpts");
  });

  it("inbox:null → seam_unavailable skip; mode off → no job", async () => {
    await ai.upsertPolicy("answer_draft", { mode: "assist", updatedBy: "op" });
    registerAnswerDraftRunner({ inbox: null, knowledge });
    await enqueueAiJob(ai, {
      scenario: "answer_draft",
      subjectType: "agent_request",
      subjectId: "ireq_x",
    });
    let calls = 0;
    const res = await drainAiJobs({
      store: ai,
      config: CFG,
      provider: {
        id: "s",
        complete: async () => {
          calls++;
          return { text: "{}", usage: { total: 1 }, model: "m" };
        },
      },
    });
    expect(calls).toBe(0);
    expect(res.skipped).toBe(1);

    await ai.upsertPolicy("answer_draft", { mode: "off", updatedBy: "op" });
    const enq = await enqueueAiIntakeJobs(
      ai,
      { requestId: "ireq_y" },
      ["answer_draft"],
    );
    expect(enq).toHaveLength(0);
  });
});

describe("admin detail — editable AI draft suggestion", () => {
  it("prefills respond textarea labeled 'AI draft' — human submits", async () => {
    const opStore = createMemoryOperatorStore();
    const { key } = await seedOperator(opStore, "AI Ops");
    const basic = `Basic ${Buffer.from(`ops:${key}`).toString("base64")}`;
    const rec = await seedRequest("ireq_d3");
    await ai.appendRun({
      scenario: "answer_draft",
      subjectType: "agent_request",
      subjectId: rec.id,
      modeAtTime: "assist",
      status: "success",
      output: DRAFT_OUT,
      confidence: 0.72,
    });
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route(
      "/",
      createAgentInteractionAdminUi({
        stores: inbox,
        operatorStore: opStore,
        aiStore: ai,
      }),
    );
    const r = await app.request(`/admin/interactions/${rec.id}`, {
      headers: { authorization: basic },
    });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("AI draft");
    expect(body).toContain(DRAFT_OUT.draftText);
    // the draft is inside the EDITABLE respond form, never auto-sent —
    // the only outbound path stays the human's POST to /respond.
    expect(body).toContain(`action="/admin/interactions/${rec.id}/respond"`);
  });

  it("shadow-run draft never reaches the textarea (blind)", async () => {
    const opStore = createMemoryOperatorStore();
    const { key } = await seedOperator(opStore, "AI Ops");
    const basic = `Basic ${Buffer.from(`ops:${key}`).toString("base64")}`;
    const rec = await seedRequest("ireq_d4");
    await ai.appendRun({
      scenario: "answer_draft",
      subjectType: "agent_request",
      subjectId: rec.id,
      modeAtTime: "shadow",
      status: "success",
      output: { ...DRAFT_OUT, draftText: "SHADOW_DRAFT_SENTINEL" },
      confidence: 0.7,
    });
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route(
      "/",
      createAgentInteractionAdminUi({
        stores: inbox,
        operatorStore: opStore,
        aiStore: ai,
      }),
    );
    const r = await app.request(`/admin/interactions/${rec.id}`, {
      headers: { authorization: basic },
    });
    const body = await r.text();
    expect(body).not.toContain("SHADOW_DRAFT_SENTINEL");
    expect(body).not.toContain("AI draft");
  });
});
