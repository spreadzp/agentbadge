/**
 * EPIC-232 (SLICE-232-1, D-232-7/8): AiJob outbox worker —
 * ChainTxOutbox dispatch pattern (board/dispatch.ts).
 *
 *   claimJobs (queued + expired-lease working, atomic, attempts++)
 *     → gates: kill-switch → declared policy mode → budget
 *     → scenario runner prompt → LlmProvider.complete
 *     → AiRun written on EVERY attempt (success/invalid_json/
 *       timeout/error AND gated skips — full audit, landmine)
 *     → job done | re-queued (attempts < max) | failed | skipped
 *
 * Fail-open everywhere: provider errors never crash the drain and
 * never block intake — a broken provider just yields audited
 * error rows and jobs that exhaust their attempts into `failed`.
 *
 * `drainAiJobs` is exported for tests; `startAiWorker` is the
 * env-gated interval service wired in wiring/background.ts.
 */

import type { AiEnvConfig } from "../../../config/env/ai-types";
import { getConfig } from "../../../config/env";
import { getDatabase } from "../database";

import { createAiAlertSender, type AiAlertSender } from "./alerts";
import { applyBudgetDegradation, checkBudget, resolveEffectiveMode } from "./budget";
import { pickAiStores } from "./db-stores";
import { LlmError, createOpenAiProvider, type LlmProvider } from "./provider";
import { getScenarioRunner, isNotAvailable } from "./scenarios";
import type { AiStore } from "./types";
import { recordError, recordSkip, skipReason } from "./worker-record";

export interface DrainAiDeps {
  store?: AiStore;
  /** `getConfig().ai` — undefined when AI_AUTOMATION_ENABLED is off. */
  config?: AiEnvConfig;
  /** Provider seam — undefined → built from config; null → forced absent. */
  provider?: LlmProvider | null;
  alert?: AiAlertSender;
  /** Jobs claimed per drain (default 25). */
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface AiDrainResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * One drain pass over claimable jobs. Called by the interval service
 * and directly by tests.
 */
export async function drainAiJobs(deps: DrainAiDeps = {}): Promise<AiDrainResult> {
  const res: AiDrainResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  const store = deps.store ?? pickAiStores(getDatabase());
  // `config: undefined` passed explicitly = forced kill-switch (tests);
  // absent key = read the live env.
  const cfg = "config" in deps ? deps.config : getConfig().ai;
  const provider =
    deps.provider !== undefined ? deps.provider : createOpenAiProvider(cfg);
  const alert = deps.alert ?? createAiAlertSender();
  const enabled = cfg?.enabled === true;
  const leaseMs = deps.leaseMs ?? cfg?.jobLeaseMs ?? 120_000;
  const maxAttempts = deps.maxAttempts ?? cfg?.jobMaxAttempts ?? 3;
  const now = deps.now ?? (() => new Date());

  const nowDate = now();
  const jobs = await store.claimJobs({
    limit: deps.limit ?? 25,
    reclaimBefore: new Date(nowDate.getTime() - leaseMs).toISOString(),
    now: nowDate.toISOString(),
  });

  for (const job of jobs) {
    res.processed++;
    let modeAtTime = "off";
    try {
      const policy = await store.getPolicy(job.scenario);
      const declaredMode = policy?.mode ?? "off";
      // Budget is read per job — call count grows inside the drain.
      const budget = enabled
        ? await checkBudget(store, cfg!, now())
        : { state: "ok" as const, dailyCalls: 0, monthlyUsdEstimate: 0 };
      const effective = resolveEffectiveMode(declaredMode, {
        enabled,
        budget: budget.state,
      });
      modeAtTime = effective;

      if (effective === "off") {
        const reason = skipReason(enabled, declaredMode, budget.state);
        if (budget.state === "exhausted" && declaredMode !== "off") {
          await applyBudgetDegradation(
            store,
            declaredMode,
            job.scenario,
            budget,
            cfg!,
            alert,
            now(),
          );
        }
        await recordSkip(store, job, effective, reason);
        res.skipped++;
        continue;
      }

      if (!provider) {
        const terminal = await recordError(
          store,
          job,
          effective,
          "error",
          "no_provider: AI_API_KEY/AI_BASE_URL not configured",
          maxAttempts,
        );
        if (terminal === "failed") res.failed++;
        res.errors.push(`${job.id} ${job.scenario}: no_provider`);
        continue;
      }

      const runner = getScenarioRunner(job.scenario);
      if (!runner) {
        const terminal = await recordError(
          store,
          job,
          effective,
          "error",
          `no_runner: scenario ${job.scenario} has no registered runner`,
          maxAttempts,
        );
        if (terminal === "failed") res.failed++;
        res.errors.push(`${job.id} ${job.scenario}: no_runner`);
        continue;
      }

      const prompt = await runner({ job, store });
      // Soft-dep degrade (232-4): the runner's seam is absent —
      // audit a skipped run, spend zero provider calls.
      if (isNotAvailable(prompt)) {
        const reason = `seam_unavailable: ${prompt.notAvailable}`;
        await recordSkip(store, job, effective, reason);
        res.skipped++;
        res.errors.push(`${job.id} ${job.scenario}: ${reason}`);
        continue;
      }
      const t0 = Date.now();
      try {
        const out = await provider.complete({
          system: prompt.system,
          user: prompt.user,
          jsonSchema: prompt.jsonSchema,
          maxTokens: prompt.maxTokens,
          temperature: prompt.temperature,
        });
        const latencyMs = Date.now() - t0;
        let output: unknown = { text: out.text };
        let confidence: number | null = null;
        if (prompt.jsonSchema) {
          try {
            output = JSON.parse(out.text);
            const c = (output as { confidence?: unknown }).confidence;
            confidence = typeof c === "number" ? c : null;
          } catch {
            // Provider validated json_schema but emitted junk —
            // treat as invalid_json status (was retried once already).
            const terminal = await recordError(
              store,
              job,
              effective,
              "invalid_json",
              "output failed JSON.parse after schema retry",
              maxAttempts,
              { provider: provider.id, model: out.model, latencyMs },
            );
            if (terminal === "failed") res.failed++;
            continue;
          }
        }
        const run = await store.appendRun({
          scenario: job.scenario,
          subjectType: job.subjectType,
          subjectId: job.subjectId,
          modeAtTime: effective,
          inputRef: job.inputRef,
          inputHash: job.inputHash,
          output,
          confidence,
          provider: provider.id,
          model: out.model,
          promptVersion: prompt.promptVersion ?? null,
          usage: out.usage,
          tokensTotal: out.usage?.total ?? null,
          latencyMs,
          status: "success",
          jobId: job.id,
        });
        await store.completeJob(job.id, { status: "done", runId: run.id });
        res.succeeded++;
      } catch (e) {
        const err =
          e instanceof LlmError
            ? e
            : new LlmError("network", e instanceof Error ? e.message : String(e));
        const status =
          err.kind === "timeout"
            ? "timeout"
            : err.kind === "invalid_json"
              ? "invalid_json"
              : "error";
        const terminal = await recordError(
          store,
          job,
          effective,
          status,
          `${err.kind}: ${err.message}`,
          maxAttempts,
          { provider: provider.id, latencyMs: Date.now() - t0 },
        );
        if (terminal === "failed") res.failed++;
        res.errors.push(`${job.id} ${job.scenario}: ${err.kind}`);
      }
    } catch (e) {
      // Runner/store failure — audit as error, count attempts.
      const msg = e instanceof Error ? e.message : String(e);
      const terminal = await recordError(
        store,
        job,
        modeAtTime,
        "error",
        `runner_fault: ${msg}`,
        maxAttempts,
      );
      if (terminal === "failed") res.failed++;
      res.errors.push(`${job.id} ${job.scenario}: ${msg}`);
    }
  }
  return res;
}

// ─── interval service ────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * Env-gated worker (D-232-8). Off when the ai section is absent
 * (AI_AUTOMATION_ENABLED unset) or AI_WORKER_ENABLED=0/false.
 * Interval via AI_WORKER_INTERVAL_MS (default 5s).
 */
export function startAiWorker(): void {
  const cfg = getConfig().ai;
  if (!cfg?.enabled || !cfg.workerEnabled) return;
  if (_timer) return;
  _timer = setInterval(() => {
    if (_running) return;
    _running = true;
    drainAiJobs()
      .then((r) => {
        if (r.errors.length) {
          console.warn("[ai-worker]", r.errors.join(" | "));
        }
      })
      .catch((e) => console.error("[ai-worker] drain error", e))
      .finally(() => {
        _running = false;
      });
  }, cfg.workerIntervalMs);
  if (typeof _timer.unref === "function") _timer.unref();
}

/** Test/shutdown hook. */
export function stopAiWorker(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
