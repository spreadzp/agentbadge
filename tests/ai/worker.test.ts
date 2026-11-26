/**
 * SLICE-232-1: drainAiJobs + store unit tests — end-to-end
 * AiJob → provider → AiRun on the memory store, kill-switch, mode
 * gating, budget cut-order/degradation, lease reclaim, idempotent
 * enqueue, prompt registry.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { AiEnvConfig } from "../../src/config/env/ai-types";
import { resetBudgetDegraded } from "../../src/server/lib/ai/budget";
import { enqueueAiJob, AiJobContractError } from "../../src/server/lib/ai/jobs";
import { resetPromptCache, promptVersionFor } from "../../src/server/lib/ai/prompts";
import type {
  LlmProvider,
  LlmCompleteResult,
} from "../../src/server/lib/ai/provider";
import { LlmError } from "../../src/server/lib/ai/provider";
import {
  registerScenarioRunner,
  resetScenarioRunners,
} from "../../src/server/lib/ai/scenarios";
import { InMemoryAiStore } from "../../src/server/lib/ai/store-memory";
import type { AiJobRecord } from "../../src/server/lib/ai/types";
import { drainAiJobs } from "../../src/server/lib/ai/worker";

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
  retryOnce: true,
  workerEnabled: true,
  workerIntervalMs: 5_000,
  jobLeaseMs: 60_000,
  jobMaxAttempts: 3,
};

function stubProvider(
  impl?: () => Promise<LlmCompleteResult>,
): LlmProvider & { calls: number } {
  const stub = {
    id: "stub-llm",
    calls: 0,
    async complete(): Promise<LlmCompleteResult> {
      stub.calls++;
      return (
        impl?.() ?? {
          text: '{"label":"bug","confidence":0.8}',
          usage: { prompt: 4, completion: 6, total: 10 },
          model: "m-1-served",
        }
      );
    },
  };
  return stub;
}

function registerEcho(): void {
  registerScenarioRunner("classification", async () => ({
    system: "classify",
    user: "the request text",
    jsonSchema: { name: "cls", schema: { type: "object" } },
    promptVersion: promptVersionFor("classify\n"),
  }));
}

async function seedJob(
  store: InMemoryAiStore,
  over: Partial<Parameters<typeof enqueueAiJob>[1]> = {},
): Promise<AiJobRecord> {
  const { job } = await enqueueAiJob(store, {
    scenario: "classification",
    subjectType: "interaction",
    subjectId: "req-1",
    inputRef: "evt-1",
    inputHash: "h-1",
    ...over,
  });
  return job;
}

async function setMode(store: InMemoryAiStore, mode: string): Promise<void> {
  await store.upsertPolicy(
    "classification",
    { mode, updatedBy: "op-1" },
    { scenario: "classification", field: "mode", oldValue: "off", newValue: mode, actor: "op-1" },
  );
}

let store: InMemoryAiStore;

beforeEach(() => {
  store = new InMemoryAiStore();
  resetScenarioRunners();
  resetBudgetDegraded();
  resetPromptCache();
});

describe("drainAiJobs", () => {
  it("job → provider → AiRun(success) + job done", async () => {
    await setMode(store, "shadow");
    registerEcho();
    const provider = stubProvider();
    await seedJob(store);

    const res = await drainAiJobs({ store, config: CFG, provider });
    expect(res.succeeded).toBe(1);
    expect(provider.calls).toBe(1);

    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      scenario: "classification",
      subjectType: "interaction",
      subjectId: "req-1",
      status: "success",
      modeAtTime: "shadow",
      provider: "stub-llm",
      model: "m-1-served",
      tokensTotal: 10,
      confidence: 0.8,
    });
    expect((runs[0]!.output as { label: string }).label).toBe("bug");
    expect(runs[0]!.promptVersion).toBe(promptVersionFor("classify\n"));
    const job = await store.getJob(runs[0]!.jobId!);
    expect(job?.status).toBe("done");
    expect(job?.runId).toBe(runs[0]!.id);
  });

  it("AI_AUTOMATION_ENABLED off → jobs skipped, no provider call", async () => {
    await setMode(store, "shadow");
    registerEcho();
    const provider = stubProvider();
    await seedJob(store);

    const res = await drainAiJobs({ store, config: undefined, provider });
    expect(res.skipped).toBe(1);
    expect(provider.calls).toBe(0);
    const runs = await store.listRuns();
    expect(runs[0]).toMatchObject({
      status: "skipped",
      error: "automation_disabled",
      modeAtTime: "off",
    });
  });

  it("declared mode=off → skipped(mode_off), no provider call", async () => {
    // default policy — no row → off
    registerEcho();
    const provider = stubProvider();
    await seedJob(store);
    const res = await drainAiJobs({ store, config: CFG, provider });
    expect(res.skipped).toBe(1);
    expect(provider.calls).toBe(0);
    const runs = await store.listRuns();
    expect(runs[0]).toMatchObject({ status: "skipped", error: "mode_off" });
  });

  it("missing provider → error run + job failed (config fault, audited)", async () => {
    await setMode(store, "assist");
    registerEcho();
    await seedJob(store);
    const res = await drainAiJobs({ store, config: CFG, provider: null, maxAttempts: 1 });
    const runs = await store.listRuns();
    expect(runs[0]).toMatchObject({ status: "error", modeAtTime: "assist" });
    expect(runs[0]!.error).toContain("no_provider");
    expect(res.failed).toBe(1);
  });

  it("unregistered scenario → error no_runner", async () => {
    await setMode(store, "shadow");
    await seedJob(store);
    const res = await drainAiJobs({ store, config: CFG, provider: stubProvider(), maxAttempts: 1 });
    const runs = await store.listRuns();
    expect(runs[0]!.error).toContain("no_runner");
    expect(res.failed).toBe(1);
  });

  it("provider timeout → AiRun(timeout) + requeue; exhausts attempts → failed", async () => {
    await setMode(store, "shadow");
    registerEcho();
    const provider = stubProvider(async () => {
      throw new LlmError("timeout", "deadline");
    });
    await seedJob(store);
    const deps = { store, config: CFG, provider, maxAttempts: 2 };

    const r1 = await drainAiJobs(deps);
    expect(r1.errors[0]).toContain("timeout");
    let runs = await store.listRuns();
    expect(runs[0]!.status).toBe("timeout");
    // attempts=1 < 2 → re-queued
    let job = await store.getJob(runs[0]!.jobId!);
    expect(job?.status).toBe("queued");

    const r2 = await drainAiJobs(deps);
    expect(r2.failed).toBe(1);
    runs = await store.listRuns();
    expect(runs).toHaveLength(2);
    job = await store.getJob(runs[0]!.jobId!);
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(2);
  });

  it("expired lease → working job reclaimed by next drain", async () => {
    await setMode(store, "shadow");
    registerEcho();
    const provider = stubProvider();
    const job = await seedJob(store);
    // simulate a crashed worker: claimed long ago, still "working"
    await store.claimJobs({
      limit: 1,
      reclaimBefore: new Date(Date.now() - 120_000).toISOString(),
      now: new Date(Date.now() - 100_000).toISOString(),
    });
    expect((await store.getJob(job.id))!.status).toBe("working");

    const res = await drainAiJobs({
      store,
      config: CFG,
      provider,
      leaseMs: 60_000,
      now: () => new Date(),
    });
    expect(res.succeeded).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it("non-expired working job is NOT reclaimed", async () => {
    await setMode(store, "shadow");
    const job = await seedJob(store);
    await store.claimJobs({
      limit: 1,
      reclaimBefore: new Date(Date.now() - 1).toISOString(),
      now: new Date().toISOString(),
    });
    const res = await drainAiJobs({
      store,
      config: CFG,
      provider: stubProvider(),
      leaseMs: 60_000,
    });
    expect(res.processed).toBe(0);
    expect((await store.getJob(job.id))!.attempts).toBe(1);
  });
});

describe("budget guards", () => {
  it("daily limit → shadow cut first (assist keeps running)", async () => {
    const cfg: AiEnvConfig = { ...CFG, dailyCallLimit: 3, shadowReserveCalls: 2 };
    await store.upsertPolicy("classification", { mode: "shadow", updatedBy: "op" });
    await store.upsertPolicy("summary", { mode: "assist", updatedBy: "op" });
    registerScenarioRunner("classification", async () => ({ system: "s", user: "u" }));
    registerScenarioRunner("summary", async () => ({ system: "s", user: "u" }));
    const provider = stubProvider(async () => ({
      text: "ok",
      usage: { total: 5 },
      model: "m",
    }));

    // spend 2 calls → dailyCalls=2 → within reserve (3-2=1; 2>=1 → shadow_cut)
    await seedJob(store, { scenario: "summary", subjectId: "a" });
    await seedJob(store, { scenario: "summary", subjectId: "b" });
    await drainAiJobs({ store, config: cfg, provider });
    expect(provider.calls).toBe(2);

    // shadow job is cut while under the reserve threshold
    await seedJob(store, { scenario: "classification", subjectId: "s1" });
    const r1 = await drainAiJobs({ store, config: cfg, provider });
    expect(r1.skipped).toBe(1);
    const shadowRun = (await store.listRuns({ scenario: "classification" }))[0]!;
    expect(shadowRun).toMatchObject({ status: "skipped", error: "budget_shadow_cut" });

    // assist keeps running on the reserve
    await seedJob(store, { scenario: "summary", subjectId: "a3" });
    const r2 = await drainAiJobs({ store, config: cfg, provider });
    expect(r2.succeeded).toBe(1);
    expect(provider.calls).toBe(3);
  });

  it("exhausted → all gated off + PolicyChange(budget-guard) + alert", async () => {
    const cfg: AiEnvConfig = { ...CFG, dailyCallLimit: 1 };
    await setMode(store, "assist");
    registerEcho();
    const provider = stubProvider();
    const alerts: string[] = [];

    await seedJob(store, { subjectId: "first" });
    await drainAiJobs({ store, config: cfg, provider }); // spends the 1 call
    expect(provider.calls).toBe(1);

    await seedJob(store, { subjectId: "second", idempotencyKey: "k2" });
    const res = await drainAiJobs({
      store,
      config: cfg,
      provider,
      alert: async (_s, text) => {
        alerts.push(text);
      },
    });
    expect(res.skipped).toBe(1);
    expect(provider.calls).toBe(1); // no new call

    const runs = await store.listRuns({ status: "skipped" });
    expect(runs[0]).toMatchObject({ error: "budget_exhausted", modeAtTime: "off" });

    const changes = await store.listPolicyChanges({ scenario: "classification" });
    const guard = changes.filter((c) => c.actor === "budget-guard");
    expect(guard).toHaveLength(1);
    expect(guard[0]).toMatchObject({ field: "mode", oldValue: "assist", newValue: "off" });
    expect(guard[0]!.reason).toContain("budget_exhausted");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("budget exhausted");

    // stored policy row NOT rewritten — overlay, not mutation
    expect((await store.getPolicy("classification"))!.mode).toBe("assist");

    // second drain same day → deduped (no second change row / alert)
    await seedJob(store, { subjectId: "third", idempotencyKey: "k3" });
    await drainAiJobs({
      store,
      config: cfg,
      provider,
      alert: async (_s, text) => {
        alerts.push(text);
      },
    });
    expect(
      (await store.listPolicyChanges({ scenario: "classification" })).filter(
        (c) => c.actor === "budget-guard",
      ),
    ).toHaveLength(1);
    expect(alerts).toHaveLength(1);
  });
});

describe("enqueue + store semantics", () => {
  it("idempotencyKey dedupes; derived key when absent", async () => {
    const a = await enqueueAiJob(store, {
      scenario: "classification",
      subjectType: "interaction",
      subjectId: "r1",
    });
    const b = await enqueueAiJob(store, {
      scenario: "classification",
      subjectType: "interaction",
      subjectId: "r1",
    });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    expect(a.job.idempotencyKey).toBe("ai:interaction:r1:classification");
  });

  it("field caps refuse oversized input", async () => {
    await expect(
      enqueueAiJob(store, {
        scenario: "classification",
        subjectType: "interaction",
        subjectId: "x".repeat(201),
      }),
    ).rejects.toBeInstanceOf(AiJobContractError);
  });

  it("skipped runs excluded from call/token meters", async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    await store.appendRun({
      scenario: "classification",
      subjectType: "t",
      subjectId: "s",
      modeAtTime: "shadow",
      status: "success",
      tokensTotal: 10,
    });
    await store.appendRun({
      scenario: "classification",
      subjectType: "t",
      subjectId: "s",
      modeAtTime: "off",
      status: "skipped",
      tokensTotal: 0,
    });
    expect(await store.countRunsSince(since)).toBe(1);
    expect(await store.sumTokensSince(since)).toBe(10);
  });

  it("latestRunFor returns newest subject run", async () => {
    await store.appendRun({
      scenario: "classification",
      subjectType: "interaction",
      subjectId: "r1",
      modeAtTime: "shadow",
      status: "success",
    });
    const newer = await store.appendRun({
      scenario: "summary",
      subjectType: "interaction",
      subjectId: "r1",
      modeAtTime: "shadow",
      status: "error",
    });
    const latest = await store.latestRunFor("interaction", "r1");
    expect(latest?.id).toBe(newer.id);
    const cls = await store.latestRunFor("interaction", "r1", "classification");
    expect(cls?.scenario).toBe("classification");
  });
});
