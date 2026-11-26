/**
 * EPIC-232 (SLICE-232-1, D-232-8): in-memory AiStore — the
 * DATABASE_ENABLED=false fallback. Same semantics as the Postgres
 * adapter (parity is what makes the fallback honest):
 * newest-first run listing, idempotency dedupe on enqueue, atomic
 * claim (queued + expired-lease working), policy upsert with a
 * same-call audit append.
 */

import { randomUUID } from "node:crypto";

import { InMemoryAiPolicyStore } from "./store-memory-policies";
import type {
  AiJobInsert,
  AiJobRecord,
  AiRunInsert,
  AiRunRecord,
  AiStore,
  AutomationPolicyPatch,
  PolicyChangeInsert,
} from "./types";

const nowIso = () => new Date().toISOString();

/** 232-12 H-8: pre-provider fault prefixes never burned a call. */
const NO_CALL_PREFIXES = [
  "no_provider",
  "no_runner",
  "runner_fault",
  "seam_unavailable",
];
export function reachedProvider(error: string | null): boolean {
  if (error === null) return true;
  return !NO_CALL_PREFIXES.some((p) => error.startsWith(p));
}

export class InMemoryAiStore implements AiStore {
  private readonly runs = new Map<string, AiRunRecord>();
  private readonly jobs = new Map<string, AiJobRecord>();
  private readonly policyStore = new InMemoryAiPolicyStore();

  // ─── AiRun ──────────────────────────────────────────────────

  async appendRun(input: AiRunInsert): Promise<AiRunRecord> {
    // Append-only: a caller-supplied id that already exists is a
    // contract violation, not an overwrite (arc 232-11 nit).
    if (input.id !== undefined && this.runs.has(input.id)) {
      throw new Error(`ai_run_conflict: run ${input.id} already exists`);
    }
    const run: AiRunRecord = {
      id: input.id ?? randomUUID(),
      scenario: input.scenario,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      modeAtTime: input.modeAtTime,
      inputRef: input.inputRef ?? null,
      inputHash: input.inputHash ?? null,
      output: input.output ?? null,
      confidence: input.confidence ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      promptVersion: input.promptVersion ?? null,
      usage: input.usage ?? null,
      tokensTotal: input.tokensTotal ?? null,
      latencyMs: input.latencyMs ?? null,
      status: input.status,
      error: input.error ?? null,
      jobId: input.jobId ?? null,
      createdAt: nowIso(),
    };
    this.runs.set(run.id, run);
    return run;
  }

  async listRuns(opts?: {
    subjectType?: string;
    subjectId?: string;
    scenario?: string;
    modeAtTime?: string;
    status?: string;
    excludeStatus?: string;
    limit?: number;
    offset?: number;
  }): Promise<AiRunRecord[]> {
    let all = [...this.runs.values()]
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts?.subjectType !== undefined) {
      all = all.filter((r) => r.subjectType === opts.subjectType);
    }
    if (opts?.subjectId !== undefined) {
      all = all.filter((r) => r.subjectId === opts.subjectId);
    }
    if (opts?.scenario !== undefined) {
      all = all.filter((r) => r.scenario === opts.scenario);
    }
    if (opts?.modeAtTime !== undefined) {
      all = all.filter((r) => r.modeAtTime === opts.modeAtTime);
    }
    if (opts?.status !== undefined) {
      all = all.filter((r) => r.status === opts.status);
    }
    if (opts?.excludeStatus !== undefined) {
      all = all.filter((r) => r.status !== opts.excludeStatus);
    }
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async latestRunFor(
    subjectType: string,
    subjectId: string,
    scenario?: string,
  ): Promise<AiRunRecord | null> {
    const rows = await this.listRuns({ subjectType, subjectId, scenario, limit: 1 });
    return rows[0] ?? null;
  }

  async countRunsSince(sinceIso: string): Promise<number> {
    return [...this.runs.values()].filter(
      (r) => r.createdAt >= sinceIso && r.status !== "skipped",
    ).length;
  }

  async countProviderCallsSince(
    sinceIso: string,
    subjectType?: string,
  ): Promise<number> {
    return [...this.runs.values()].filter(
      (r) =>
        r.createdAt >= sinceIso &&
        (subjectType === undefined || r.subjectType === subjectType) &&
        r.status !== "skipped" &&
        reachedProvider(r.error),
    ).length;
  }

  async countJobsByStatus(status: string, subjectType?: string): Promise<number> {
    return [...this.jobs.values()].filter(
      (j) =>
        j.status === status &&
        (subjectType === undefined || j.subjectType === subjectType),
    ).length;
  }

  async sumTokensSince(sinceIso: string): Promise<number> {
    return [...this.runs.values()]
      .filter((r) => r.createdAt >= sinceIso && r.status !== "skipped")
      .reduce((s, r) => s + (r.tokensTotal ?? 0), 0);
  }

  // ─── AiJob ──────────────────────────────────────────────────

  async getJob(id: string): Promise<AiJobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async enqueueJob(
    input: AiJobInsert,
  ): Promise<{ job: AiJobRecord; duplicate: boolean }> {
    if (input.idempotencyKey) {
      const existing = [...this.jobs.values()].find(
        (j) => j.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { job: existing, duplicate: true };
    }
    const now = nowIso();
    const job: AiJobRecord = {
      id: input.id ?? randomUUID(),
      scenario: input.scenario,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      inputRef: input.inputRef ?? null,
      inputHash: input.inputHash ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      status: "queued",
      attempts: 0,
      lockedAt: null,
      lastError: null,
      runId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return { job, duplicate: false };
  }

  async claimJobs(opts: {
    limit: number;
    reclaimBefore: string;
    now: string;
    maxAttempts?: number;
  }): Promise<AiJobRecord[]> {
    // Delta-2 N-M2: sweep exhausted jobs to a terminal state — a job
    // that burned its last attempt mid-flight must not sit `working`
    // (or `queued` under a lowered max) forever.
    if (opts.maxAttempts !== undefined) {
      for (const j of this.jobs.values()) {
        if (
          (j.status === "queued" || j.status === "working") &&
          j.attempts >= opts.maxAttempts
        ) {
          j.status = "failed";
          j.lastError = "attempts_exhausted";
          j.updatedAt = opts.now;
        }
      }
    }
    const claimable = [...this.jobs.values()]
      .filter(
        (j) =>
          (j.status === "queued" ||
            (j.status === "working" &&
              j.lockedAt !== null &&
              j.lockedAt < opts.reclaimBefore)) &&
          (opts.maxAttempts === undefined || j.attempts < opts.maxAttempts),
      )
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt.localeCompare(b.createdAt),
      )
      .slice(0, Math.max(0, opts.limit));
    for (const j of claimable) {
      j.status = "working";
      j.lockedAt = opts.now;
      j.attempts += 1;
      j.updatedAt = opts.now;
    }
    // Delta-2 N-M2: CLONE on claim — the caller's record must not
    // alias the stored row, or a stale claim would read (and pass
    // CAS against) the re-claimer's lockedAt.
    return claimable.map((j) => ({ ...j }));
  }

  async completeJob(
    id: string,
    patch: { status: string; lastError?: string | null; runId?: string | null },
    opts?: { expectedLockedAt?: string | null },
  ): Promise<AiJobRecord | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    // CAS on the claimed lease — a stale claim loses to a re-claim.
    if (
      opts?.expectedLockedAt !== undefined &&
      job.lockedAt !== opts.expectedLockedAt
    ) {
      return null;
    }
    job.status = patch.status;
    if (patch.lastError !== undefined) job.lastError = patch.lastError;
    if (patch.runId !== undefined) job.runId = patch.runId;
    job.updatedAt = nowIso();
    return job;
  }

  // ─── AutomationPolicy + PolicyChange (delegate) ─────────────

  getPolicy = (scenario: string) => this.policyStore.getPolicy(scenario);
  listPolicies = () => this.policyStore.listPolicies();
  upsertPolicy = (
    scenario: string,
    patch: AutomationPolicyPatch,
    change?: PolicyChangeInsert,
  ) => this.policyStore.upsertPolicy(scenario, patch, change);
  appendPolicyChange = (input: PolicyChangeInsert) =>
    this.policyStore.appendPolicyChange(input);
  listPolicyChanges = (opts?: {
    scenario?: string;
    limit?: number;
    offset?: number;
  }) => this.policyStore.listPolicyChanges(opts);
}
