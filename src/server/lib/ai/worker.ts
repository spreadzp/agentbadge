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

import { getConfig } from "../../../config/env";
import { getDatabase } from "../database";

import { createAiAlertSender } from "./alerts";
import { notifyAiRunAppended } from "./compare";
import { pickAiStores } from "./db-stores";
import { validateScenarioOutput } from "./output-schemas";
import { LlmError, createOpenAiProvider } from "./provider";
import { getScenarioRunner, isNotAvailable } from "./scenarios";
import {
  leaseHeld,
  recordError,
  recordGatedSkip,
  recordSkip,
  resolveJobMode,
} from "./worker-record";

import type { AiDrainResult, DrainAiDeps } from "./worker-record";

export type { AiDrainResult, DrainAiDeps };

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
    // H-7: a job that already burned its attempts is never reclaimed —
    // poison payloads cannot loop forever on lease expiry.
    maxAttempts,
  });

  for (const job of jobs) {
    res.processed++;
    // Delta-2 H-7: the CAS on completeJob protects the job ROW but
    // not the side effects — check the lease FIRST so a stale claim
    // writes no runs at all (the re-claimer owns the job and will
    // produce its own audit trail).
    if (!(await leaseHeld(store, job))) {
      res.errors.push(`${job.id} ${job.scenario}: lease_lost`);
      continue;
    }
    let modeAtTime = "off";
    try {
      const { declaredMode, effective, budget } = await resolveJobMode(
        store,
        job,
        cfg!,
        enabled,
        now(),
      );
      modeAtTime = effective;

      if (effective === "off") {
        await recordGatedSkip(
          store,
          job,
          effective,
          declaredMode,
          budget,
          cfg!,
          alert,
          enabled,
          now(),
        );
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
      // Delta-2 H-7: the CAS on completeJob protects the job ROW but
      // not the side effects — re-read the lease before the provider
      // call and again before appendRun; a stale claim produces zero
      // LLM spend and zero run rows (the re-claimer owns the job).
      if (!(await leaseHeld(store, job))) {
        res.errors.push(`${job.id} ${job.scenario}: lease_lost_pre_call`);
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
        let validationError: string | null = null;
        if (prompt.jsonSchema) {
          try {
            output = JSON.parse(out.text);
            const c = (output as { confidence?: unknown }).confidence;
            confidence = typeof c === "number" ? c : null;
            // 232-12 H-4: provider json_schema is a request, not a
            // guarantee — validate the parsed output server-side
            // (per-scenario zod + the runner's job-context checks).
            validationError =
              validateScenarioOutput(job.scenario, output) ??
              prompt.validateOutput?.(output) ??
              null;
          } catch {
            validationError =
              "output failed JSON.parse after schema retry";
          }
          if (validationError !== null) {
            const terminal = await recordError(
              store,
              job,
              effective,
              "invalid_json",
              validationError,
              maxAttempts,
              {
                provider: provider.id,
                model: out.model,
                promptVersion: prompt.promptVersion ?? null,
                latencyMs,
                // Delta-2 H-8: provider billed this attempt.
                usage: out.usage,
                tokensTotal: out.usage?.total ?? null,
              },
            );
            if (terminal === "failed") res.failed++;
            continue;
          }
        }
        // Delta-2 H-7/N-H1: lease re-check BEFORE appendRun — a stale
        // claim must not write a run that masks the winner's result
        // (newest-first readers would show the loser's error/stale
        // row instead of the winner's success).
        if (!(await leaseHeld(store, job))) {
          res.errors.push(`${job.id} ${job.scenario}: lease_lost_pre_append`);
          continue;
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
        const completed = await store.completeJob(
          job.id,
          { status: "done", runId: run.id },
          { expectedLockedAt: job.lockedAt },
        );
        // CAS lost between append and complete — the run row stands
        // (append-only) but the job belongs to another claim; do not
        // count or trigger comparisons for it.
        if (completed === null) {
          res.errors.push(`${job.id} ${job.scenario}: lease_lost_complete`);
          continue;
        }
        res.succeeded++;
        // 232-12 H-9: a shadow run that finishes AFTER the human
        // outcome still gets its lazy comparison — registered
        // checkers decide whether an outcome exists yet.
        await notifyAiRunAppended(store, run);
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
          {
            provider: provider.id,
            promptVersion: prompt.promptVersion ?? null,
            latencyMs: Date.now() - t0,
            // Delta-2 H-8: usage the provider billed before failing.
            usage: err.usage ?? null,
            tokensTotal: err.usage?.total ?? null,
          },
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
