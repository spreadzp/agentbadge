/**
 * SLICE-232-2: E1+E2 intake scenarios — enqueue hook on committed
 * interaction requests, runner prompt construction, e2e job→run,
 * suggestion view-model, and the §16.5 suggestion-only boundary.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import { createAgentInteractionRoutes } from "../../src/server/routes/agent-interaction/agent-interaction-api";
import { createAgentInteractionAdminUi } from "../../src/server/routes/agent-interaction/agent-interaction-admin-ui";
import {
  createMemoryRequestInboxStores,
  type RequestInboxStores,
} from "../../src/server/lib/request-inbox";
import {
  buildEvent,
  emitInteractionHooks,
} from "../../src/server/lib/agent-interaction/events";
import { createMemoryOperatorStore, seedOperator } from "../helpers/operators";

import {
  enqueueAiIntakeJobs,
  loadAiSuggestions,
  registerAiIntakeHook,
  resetAiIntakeHook,
} from "../../src/server/lib/ai/intake";
import { registerIntakeRunners } from "../../src/server/lib/ai/intake-runners";
import { enqueueAiJob } from "../../src/server/lib/ai/jobs";
import { loadPrompt, resetPromptCache } from "../../src/server/lib/ai/prompts";
import type { LlmProvider, LlmCompleteResult } from "../../src/server/lib/ai/provider";
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
};

const INBOX_ENV = {
  fingerprintSalt: "test-salt-12345",
  requestTtlMs: 3_600_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

const FP = { ip: null, ua: null, referer: null, src: null, headers: {} };

let ai: InMemoryAiStore;
let inbox: RequestInboxStores;

const setMode = (scenario: string, mode: string, threshold?: number) =>
  ai.upsertPolicy(scenario, {
    mode,
    confidenceThreshold: threshold ?? null,
    updatedBy: "op",
  });

function stubProvider(result: () => LlmCompleteResult): LlmProvider {
  return {
    id: "stub",
    complete: async () => result(),
  };
}

const CLS_OUT = {
  category: "question",
  intent: "INTEGRATION_HELP",
  capabilities: ["payments", "api"],
  confidence: 0.8,
};
const SUM_OUT = {
  summary: "Agent asks how to pay.",
  keyFacts: ["wants x402 flow"],
  confidence: 0.9,
};

let n = 0;
async function submitInteraction(
  app: Hono<{ Variables: Record<string, unknown> }>,
  text = "how do I pay with x402?",
): Promise<string> {
  n += 1;
  const r = await app.request("/api/v1/agent/interaction", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `ai-${Date.now()}-${n}`,
      "fly-client-ip": `10.9.${n}.1`,
    },
    body: JSON.stringify({ type: "question", text }),
  });
  expect(r.status).toBe(202);
  return (await r.json()).requestId as string;
}

beforeEach(() => {
  ai = new InMemoryAiStore();
  inbox = createMemoryRequestInboxStores();
  resetScenarioRunners();
  resetAiIntakeHook();
  resetPromptCache();
});

describe("enqueueAiIntakeJobs", () => {
  it("mode≠off → one job per scenario; off → none", async () => {
    await setMode("classification", "shadow");
    await setMode("summary", "off");
    const res = await enqueueAiIntakeJobs(ai, {
      requestId: "ireq_1",
      inputHash: "sha-1",
    });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ scenario: "classification" });
    const job = await ai.getJob(res[0]!.jobId);
    expect(job).toMatchObject({
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "ireq_1",
      inputHash: "sha-1",
      status: "queued",
    });
    // absent policy row resolves off → skipped
    const again = await enqueueAiIntakeJobs(ai, {
      requestId: "ireq_2",
    });
    expect(again.map((r) => r.scenario)).toEqual(["classification"]);
  });

  it("repeat intake on same request replays idempotencyKey", async () => {
    await setMode("classification", "assist");
    const a = await enqueueAiIntakeJobs(ai, { requestId: "ireq_x" });
    const b = await enqueueAiIntakeJobs(ai, { requestId: "ireq_x" });
    expect(b[0]!.duplicate).toBe(true);
    expect(b[0]!.jobId).toBe(a[0]!.jobId);
  });
});

describe("registerAiIntakeHook", () => {
  it("INTERNAL request.received → enqueues when enabled; PUBLIC ignored", async () => {
    await setMode("summary", "shadow");
    registerAiIntakeHook({
      aiStore: ai,
      config: () => CFG,
    });
    // emit via the same seam createRequest uses — INTERNAL event
    emitInteractionHooks("ireq_9", [
      buildEvent("interaction.request.received", "PUBLIC", {
        requestId: "ireq_9",
      }),
      buildEvent("interaction.request.received", "INTERNAL", {
        requestId: "ireq_9",
        payloadSha256: "deadbeef",
      }),
    ]);
    // hook is fire-and-forget — settle microtasks
    await new Promise((r) => setTimeout(r, 10));
    const res = await enqueueAiIntakeJobs(ai, { requestId: "ireq_9" }); // dupes → confirms what got queued
    expect(res.map((r) => `${r.scenario}:${r.duplicate}`)).toEqual([
      "summary:true",
    ]);
  });

  it("kill-switch off → nothing queued", async () => {
    await setMode("summary", "shadow");
    registerAiIntakeHook({
      aiStore: ai,
      config: () => undefined, // AI_AUTOMATION_ENABLED unset
    });
    emitInteractionHooks("ireq_k", [
      buildEvent("interaction.request.received", "INTERNAL", {
        requestId: "ireq_k",
      }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    // no job exists — a manual enqueue attempt would NOT dedupe
    const res = await enqueueAiIntakeJobs(ai, { requestId: "ireq_k" });
    expect(res[0]!.duplicate).toBe(false);
  });
});

describe("intake runners", () => {
  it("classification runner: subject → prompt w/ intent enum + promptVersion", async () => {
    registerIntakeRunners({ stores: inbox });
    const { record } = await inbox.requests.submit({
      id: "ireq_c1",
      state: "submitted",
      kind: "question",
      payload: { text: "how do I verify a signature?" },
      fingerprint: FP,
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    const { job } = await enqueueAiJob(ai, {
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: record.id,
    });
    const runner = getScenarioRunner("classification")!;
    const prompt = await runner({ job, store: ai });
    expect(prompt.user).toContain("how do I verify a signature?");
    expect(prompt.user).toContain("declared kind: question");
    const schema = prompt.jsonSchema!.schema as {
      properties: { intent: { enum: string[] }; category: { enum: string[] } };
    };
    expect(schema.properties.intent.enum).toContain("INTEGRATION_HELP");
    expect(schema.properties.category.enum).toContain("bug");
    expect(prompt.promptVersion).toBe(loadPrompt("classification")!.version);
    expect(loadPrompt("classification")!.text).toContain("CAPABILITY_DISCOVERY");
  });

  it("missing/expired subject → runner throws (audited error)", async () => {
    registerIntakeRunners({ stores: inbox });
    const { job } = await enqueueAiJob(ai, {
      scenario: "summary",
      subjectType: "agent_request",
      subjectId: "ireq_gone",
    });
    const runner = getScenarioRunner("summary")!;
    await expect(runner({ job, store: ai })).rejects.toThrow(
      "subject_not_found",
    );
  });
});

describe("e2e intake → job → run", () => {
  it("POST intake → hook enqueues → drain → AiRun(success) with parsed output", async () => {
    await setMode("classification", "shadow");
    await setMode("summary", "shadow");
    registerIntakeRunners({ stores: inbox });
    registerAiIntakeHook({ aiStore: ai, config: () => CFG });

    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route("/", createAgentInteractionRoutes({ stores: inbox, env: INBOX_ENV }));
    const requestId = await submitInteraction(app);
    await new Promise((r) => setTimeout(r, 10)); // hook settle

    const provider = stubProvider(() => ({
      text: JSON.stringify(CLS_OUT),
      usage: { total: 12 },
      model: "m",
    }));
    // summary also enqueued — provider returns cls shape for both;
    // summary schema parse still succeeds (JSON.parse only).
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(res.succeeded).toBe(2);

    const clsRun = await ai.latestRunFor("agent_request", requestId, "classification");
    expect(clsRun).toMatchObject({
      status: "success",
      modeAtTime: "shadow",
      confidence: 0.8,
    });
    expect(clsRun!.output).toMatchObject({ intent: "INTEGRATION_HELP" });
  });

  it("provider returns non-JSON → AiRun(invalid_json)", async () => {
    await setMode("classification", "shadow");
    registerIntakeRunners({ stores: inbox });
    const { record } = await inbox.requests.submit({
      id: "ireq_bad",
      state: "submitted",
      payload: { text: "???" },
      fingerprint: FP,
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    await enqueueAiJob(ai, {
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: record.id,
    });
    const provider = stubProvider(() => ({
      text: "definitely not json",
      usage: {},
      model: "m",
    }));
    const res = await drainAiJobs({ store: ai, config: CFG, provider });
    expect(res.failed).toBe(1);
    const run = await ai.latestRunFor("agent_request", record.id, "classification");
    expect(run!.status).toBe("invalid_json");
  });
});

describe("loadAiSuggestions (§16.5 admin view-model)", () => {
  it("run + threshold → belowThreshold flag; no run → none", async () => {
    await setMode("classification", "assist", 0.9);
    await ai.appendRun({
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "ireq_v",
      modeAtTime: "assist",
      status: "success",
      output: CLS_OUT,
      confidence: 0.7, // below 0.9 threshold
      model: "m",
      promptVersion: "abc123def456",
    });
    await ai.appendRun({
      scenario: "summary",
      subjectType: "agent_request",
      subjectId: "ireq_v",
      modeAtTime: "assist",
      status: "success",
      output: SUM_OUT,
      confidence: 0.95,
    });
    const views = await loadAiSuggestions(ai, "ireq_v");
    const cls = views.find((v) => v.scenario === "classification")!;
    expect(cls.belowThreshold).toBe(true);
    expect(cls.threshold).toBe(0.9);
    const sum = views.find((v) => v.scenario === "summary")!;
    expect(sum.status).toBe("success");
    expect(sum.belowThreshold).toBe(false);
    // scenario with no run → none
    const none = await loadAiSuggestions(ai, "ireq_v", ["knowledge_search"]);
    expect(none[0]!.status).toBe("none");
  });
});

describe("admin detail page (§16.5 display)", () => {
  it("renders 'AI suggestion' block next to human classification — suggestion only", async () => {
    const opStore = createMemoryOperatorStore();
    const { key } = await seedOperator(opStore, "AI Ops");
    const basic = `Basic ${Buffer.from(`ops:${key}`).toString("base64")}`;

    const { record } = await inbox.requests.submit({
      id: "ireq_ui1",
      state: "submitted",
      payload: { text: "verify?" },
      fingerprint: FP,
      fpHash: "f",
      expiresAtMs: Date.now() + 60_000,
    });
    await ai.appendRun({
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: record.id,
      modeAtTime: "assist",
      status: "success",
      output: CLS_OUT,
      confidence: 0.8,
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
    const r = await app.request(`/admin/interactions/${record.id}`, {
      headers: { authorization: basic },
    });
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("AI suggestion");
    expect(body).toContain("advisory");
    expect(body).toContain("INTEGRATION_HELP");
    // human classify form untouched — suggestion is a separate block
    expect(body).toContain('name="intent"');
    expect(body).not.toContain('value="INTEGRATION_HELP" selected');
  });
});
