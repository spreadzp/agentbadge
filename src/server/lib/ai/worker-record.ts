/**
 * EPIC-232 (SLICE-232-1): worker-side run/job recording helpers —
 * split out of worker.ts for the max-lines gate. Every code path
 * lands an AiRun row (incl. gated skips) before the job state
 * transition so the audit stream is complete by construction.
 */

import type { AiEnvConfig } from "../../../config/env/ai-types";
import type { AiAlertSender } from "./alerts";
import {
  applyBudgetDegradation,
  checkBudget,
  resolveEffectiveMode,
} from "./budget";
import type { BudgetState } from "./budget";
import { capError } from "./jobs";
import type { LlmProvider } from "./provider";
import type { AiJobRecord, AiStore, AiUsage } from "./types";

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
 * Delta-2 H-7: does this worker still hold the lease it claimed?
 * The job row is the single source of truth — a re-claim (lease
 * expiry) rewrites `lockedAt`; a stale claim compares its own
 * claim-time value and loses. Caller-side check because the CAS on
 * `completeJob` protects the row, not the side effects.
 */
export async function leaseHeld(
  store: AiStore,
  job: AiJobRecord,
): Promise<boolean> {
  const cur = await store.getJob(job.id);
  return cur !== null && cur.lockedAt === job.lockedAt;
}

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

/** Per-job mode resolution: policy + live budget → effective mode. */
export async function resolveJobMode(
  store: AiStore,
  job: AiJobRecord,
  cfg: AiEnvConfig,
  enabled: boolean,
  now: Date,
): Promise<{
  declaredMode: string;
  effective: string;
  budget: {
    state: "ok" | "shadow_cut" | "exhausted";
    dailyCalls: number;
    monthlyUsdEstimate: number;
  };
}> {
  const policy = await store.getPolicy(job.scenario);
  const declaredMode = policy?.mode ?? "off";
  // Budget is read per job — call count grows inside the drain.
  const budget = enabled
    ? await checkBudget(store, cfg, now, job.subjectType)
    : { state: "ok" as const, dailyCalls: 0, monthlyUsdEstimate: 0 };
  return {
    declaredMode,
    effective: resolveEffectiveMode(declaredMode, {
      enabled,
      budget: budget.state,
    }),
    budget,
  };
}

/** Gated-out path: degrade policy on exhaustion + skipped run. */
export async function recordGatedSkip(
  store: AiStore,
  job: AiJobRecord,
  effective: string,
  declaredMode: string,
  budget: BudgetState,
  cfg: AiEnvConfig,
  alert: AiAlertSender,
  enabled: boolean,
  now: Date,
): Promise<void> {
  const reason = skipReason(enabled, declaredMode, budget.state);
  if (budget.state === "exhausted" && declaredMode !== "off") {
    await applyBudgetDegradation(
      store,
      declaredMode,
      job.scenario,
      budget,
      cfg,
      alert,
      now,
    );
  }
  await recordSkip(store, job, effective, reason);
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
  await store.completeJob(
    job.id,
    { status: "skipped", lastError: reason, runId: run.id },
    { expectedLockedAt: job.lockedAt },
  );
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
    /** Delta-2 H-8: billed usage on failed provider attempts. */
    usage?: AiUsage | null;
    tokensTotal?: number | null;
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
    usage: extra?.usage ?? null,
    tokensTotal: extra?.tokensTotal ?? extra?.usage?.total ?? null,
    status,
    error: reason,
    jobId: job.id,
  });
  const terminal = job.attempts >= maxAttempts ? "failed" : "queued";
  await store.completeJob(
    job.id,
    { status: terminal, lastError: reason, runId: run.id },
    { expectedLockedAt: job.lockedAt },
  );
  return terminal;
}
