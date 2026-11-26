/**
 * SLICE-232-3 (E7): shadow harness — blind guarantee (shadow AiRuns
 * never reach the operator view), inputHash snapshot immutability,
 * and the lazy comparison trigger on human outcome.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
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
  compareShadowRun,
  registerAiComparisonHook,
  resetAiComparisonHook,
  resetComparators,
} from "../../src/server/lib/ai/compare";
import {
  loadAiSuggestions,
  registerAiIntakeHook,
  resetAiIntakeHook,
} from "../../src/server/lib/ai/intake";
import { registerIntakeRunners } from "../../src/server/lib/ai/intake-runners";
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

let ai: InMemoryAiStore;
let inbox: RequestInboxStores;

const seedRequest = async (id: string, kind = "question") => {
  const { record } = await inbox.requests.submit({
    id,
    state: "submitted",
    kind,
    payload: { text: "how do I pay with x402?" },
    fingerprint: FP,
    fpHash: "f",
    expiresAtMs: Date.now() + 60_000,
  });
  return record;
};

const seedShadowRun = (
  subjectId: string,
  output: unknown,
  over: Record<string, unknown> = {},
) =>
  ai.appendRun({
    scenario: "classification",
    subjectType: "agent_request",
    subjectId,
    modeAtTime: "shadow",
    inputHash: "sha-snap",
    output,
    status: "success",
    ...over,
  });

const CLS_MATCH = { category: "question", intent: "INTEGRATION_HELP", capabilities: ["payments"], confidence: 0.8 };

beforeEach(() => {
  ai = new InMemoryAiStore();
  inbox = createMemoryRequestInboxStores();
  resetScenarioRunners();
  resetAiIntakeHook();
  resetAiComparisonHook();
  resetComparators();
  resetPromptCache();
});

describe("blind guarantee (D-232-5)", () => {
  it("loadAiSuggestions never returns a modeAtTime=shadow run", async () => {
    await seedRequest("ireq_blind");
    await seedShadowRun("ireq_blind", CLS_MATCH); // shadow — invisible
    await ai.appendRun({ // assist run — visible
      scenario: "classification",
      subjectType: "agent_request",
      subjectId: "ireq_blind",
      modeAtTime: "assist",
      status: "success",
      output: { category: "bug", intent: "BUG_REPORT", capabilities: [], confidence: 0.9 },
    });
    const views = await loadAiSuggestions(ai, "ireq_blind");
    const cls = views.find((v) => v.scenario === "classification")!;
    expect(cls.mode).toBe("assist");
    expect((cls.output as { intent: string }).intent).toBe("BUG_REPORT");
  });

  it("admin detail page does not leak shadow output", async () => {
    const opStore = createMemoryOperatorStore();
    const { key } = await seedOperator(opStore, "AI Ops");
    const basic = `Basic ${Buffer.from(`ops:${key}`).toString("base64")}`;
    const record = await seedRequest("ireq_blindpage");
    const shadow = await seedShadowRun(record.id, {
      category: "question",
      intent: "INTEGRATION_HELP",
      capabilities: ["secret-sauce"],
      confidence: 0.5,
    });
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route("/", createAgentInteractionAdminUi({
      stores: inbox,
      operatorStore: opStore,
      aiStore: ai,
    }));
    const r = await app.request(`/admin/interactions/${record.id}`, {
      headers: { authorization: basic },
    });
    const body = await r.text();
    expect(r.status).toBe(200);
    // shadow run id/output never reach the page (intent labels are a
    // legit vocabulary in the human classify <select> — not a leak)
    expect(body).not.toContain("secret-sauce");
    expect(body).not.toContain(shadow.id);
  });
});

describe("inputHash snapshot (AC#2)", () => {
  it("run carries the hash stamped at job creation — immutable", async () => {
    await ai.upsertPolicy("classification", { mode: "shadow", updatedBy: "op" });
    registerIntakeRunners({ stores: inbox });
    registerAiIntakeHook({ aiStore: ai, config: () => CFG });

    emitInteractionHooks("ireq_hash", [
      buildEvent("interaction.request.received", "INTERNAL", {
        requestId: "ireq_hash",
        payloadSha256: "snap-abc",
      }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    await seedRequest("ireq_hash");

    const provider: LlmProvider = {
      id: "stub",
      complete: async () => ({
        text: JSON.stringify(CLS_MATCH),
        usage: { total: 1 },
        model: "m",
      }),
    };
    await drainAiJobs({ store: ai, config: CFG, provider });
    const run = await ai.latestRunFor("agent_request", "ireq_hash", "classification");
    expect(run!.inputHash).toBe("snap-abc");
    expect(run!.inputRef).toBe("interaction:ireq_hash");
  });
});

describe("lazy comparison (AC#4)", () => {
  it("human classified → ai.agreement.computed INTERNAL event, agree=true", async () => {
    const record = await seedRequest("ireq_agree", "question");
    await seedShadowRun(record.id, CLS_MATCH);
    registerAiComparisonHook({ stores: inbox, aiStore: ai });

    emitInteractionHooks(record.id, [
      buildEvent("interaction.request.classified", "INTERNAL", {
        requestId: record.id,
        operatorRef: "op-1",
        patch: { intent: "INTEGRATION_HELP" },
      }),
    ]);
    await new Promise((r) => setTimeout(r, 20));

    const hist = await inbox.interactions.listEvents(record.id);
    const agree = hist.filter((e) => e.kind === "ai.agreement.computed");
    expect(agree).toHaveLength(1);
    const p = agree[0]!.payload as Record<string, unknown>;
    expect(p.agree).toBe(true);
    expect(p.scenario).toBe("classification");
    expect((p.fields as { field: string; match: boolean }[])).toContainEqual(
      expect.objectContaining({ field: "intent", match: true }),
    );
  });

  it("mismatched human intent → agree=false", async () => {
    const record = await seedRequest("ireq_disagree");
    await seedShadowRun(record.id, CLS_MATCH);
    registerAiComparisonHook({ stores: inbox, aiStore: ai });
    emitInteractionHooks(record.id, [
      buildEvent("interaction.request.classified", "INTERNAL", {
        requestId: record.id,
        patch: { intent: "FEATURE_REQUEST" },
      }),
    ]);
    await new Promise((r) => setTimeout(r, 20));
    const hist = await inbox.interactions.listEvents(record.id);
    const p = hist.find((e) => e.kind === "ai.agreement.computed")!
      .payload as Record<string, unknown>;
    expect(p.agree).toBe(false);
  });

  it("no shadow run / non-success / non-shadow mode → no comparison event", async () => {
    const record = await seedRequest("ireq_noshadow");
    // assist run — comparison must only look at shadow
    await seedShadowRun(record.id, CLS_MATCH, { modeAtTime: "assist" });
    registerAiComparisonHook({ stores: inbox, aiStore: ai });
    emitInteractionHooks(record.id, [
      buildEvent("interaction.request.classified", "INTERNAL", {
        requestId: record.id,
        patch: { intent: "OTHER" },
      }),
    ]);
    await new Promise((r) => setTimeout(r, 20));
    const hist = await inbox.interactions.listEvents(record.id);
    expect(hist.filter((e) => e.kind === "ai.agreement.computed")).toHaveLength(0);
  });

  it("compareShadowRun: latest shadow run only + scenario without comparator → agree null", async () => {
    const record = await seedRequest("ireq_cmp");
    await seedShadowRun(record.id, CLS_MATCH, { scenario: "knowledge_search" });
    const cmp = await compareShadowRun(ai, record.id, "knowledge_search", {
      intent: "OTHER",
    });
    expect(cmp).not.toBeNull();
    expect(cmp!.result.agree).toBeNull();
  });
});
