/**
 * EPIC-232 (SLICE-232-1): worker-side run/job recording helpers —
 * split out of worker.ts for the max-lines gate. Every code path
 * lands an AiRun row (incl. gated skips) before the job state
 * transition so the audit stream is complete by construction.
 */

import { capError } from "./jobs";
import type { AiJobRecord, AiStore } from "./types";

export function skipReason(
  enabled: boolean,
  declaredMode: string,
  budgetState: "ok" | "shadow_cut" | "exhausted",
): string {
  if (!enabled) return "automation_disabled";
  if (declaredMode === "off") return "mode_off";
  if (budgetState === "exhausted") return "budget_exhausted";
  return "budget_shadow_cut";
}

/** Audit a gated-out job: skipped run + job → skipped. */
export async function recordSkip(
  store: AiStore,
  job: AiJobRecord,
  effective: string,
  reason: string,
): Promise<void> {
  const run = await store.appendRun({
    scenario: job.scenario,
    subjectType: job.subjectType,
    subjectId: job.subjectId,
    modeAtTime: effective,
    inputRef: job.inputRef,
    inputHash: job.inputHash,
    status: "skipped",
    error: reason,
    jobId: job.id,
  });
  await store.completeJob(job.id, {
    status: "skipped",
    lastError: reason,
    runId: run.id,
  });
}

/**
 * Audit a failed attempt: error/timeout/invalid_json run + job →
 * queued (attempts remain → next tick re-claims it) or failed.
 * Job-level retry is distinct from the provider's internal 1-retry.
 */
export async function recordError(
  store: AiStore,
  job: AiJobRecord,
  effective: string,
  status: "error" | "timeout" | "invalid_json",
  err: string,
  maxAttempts: number,
  extra?: {
    provider?: string | null;
    model?: string | null;
    promptVersion?: string | null;
    latencyMs?: number | null;
  },
): Promise<"failed" | "queued"> {
  const reason = capError(err) ?? "unknown";
  const run = await store.appendRun({
    scenario: job.scenario,
    subjectType: job.subjectType,
    subjectId: job.subjectId,
    modeAtTime: effective,
    inputRef: job.inputRef,
    inputHash: job.inputHash,
    provider: extra?.provider ?? null,
    model: extra?.model ?? null,
    promptVersion: extra?.promptVersion ?? null,
    latencyMs: extra?.latencyMs ?? null,
    status,
    error: reason,
    jobId: job.id,
  });
  const terminal = job.attempts >= maxAttempts ? "failed" : "queued";
  await store.completeJob(job.id, {
    status: terminal,
    lastError: reason,
    runId: run.id,
  });
  return terminal;
}
