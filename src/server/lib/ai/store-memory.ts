/**
 * EPIC-232 (SLICE-232-1, D-232-8): in-memory AiStore — the
 * DATABASE_ENABLED=false fallback. Same semantics as the Postgres
 * adapter (parity is what makes the fallback honest):
 * newest-first run listing, idempotency dedupe on enqueue, atomic
 * claim (queued + expired-lease working), policy upsert with a
 * same-call audit append.
 */

import { randomUUID } from "node:crypto";

import type {
  AiJobInsert,
  AiJobRecord,
  AiRunInsert,
  AiRunRecord,
  AiStore,
  AutomationPolicyPatch,
  AutomationPolicyRecord,
  PolicyChangeInsert,
  PolicyChangeRecord,
} from "./types";

const nowIso = () => new Date().toISOString();

export class InMemoryAiStore implements AiStore {
  private readonly runs = new Map<string, AiRunRecord>();
  private readonly jobs = new Map<string, AiJobRecord>();
  private readonly policies = new Map<string, AutomationPolicyRecord>();
  private readonly policyChanges = new Map<string, PolicyChangeRecord>();

  // ─── AiRun ──────────────────────────────────────────────────

  async appendRun(input: AiRunInsert): Promise<AiRunRecord> {
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
  }): Promise<AiJobRecord[]> {
    const claimable = [...this.jobs.values()]
      .filter(
        (j) =>
          j.status === "queued" ||
          (j.status === "working" &&
            j.lockedAt !== null &&
            j.lockedAt < opts.reclaimBefore),
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
    return claimable;
  }

  async completeJob(
    id: string,
    patch: { status: string; lastError?: string | null; runId?: string | null },
  ): Promise<AiJobRecord | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = patch.status;
    if (patch.lastError !== undefined) job.lastError = patch.lastError;
    if (patch.runId !== undefined) job.runId = patch.runId;
    job.updatedAt = nowIso();
    return job;
  }

  // ─── AutomationPolicy + PolicyChange ────────────────────────

  async getPolicy(scenario: string): Promise<AutomationPolicyRecord | null> {
    return (
      [...this.policies.values()].find((p) => p.scenario === scenario) ?? null
    );
  }

  async listPolicies(): Promise<AutomationPolicyRecord[]> {
    return [...this.policies.values()].sort((a, b) =>
      a.scenario.localeCompare(b.scenario),
    );
  }

  async upsertPolicy(
    scenario: string,
    patch: AutomationPolicyPatch,
    change?: PolicyChangeInsert,
  ): Promise<{ policy: AutomationPolicyRecord; change: PolicyChangeRecord | null }> {
    const now = nowIso();
    let policy = await this.getPolicy(scenario);
    if (!policy) {
      policy = {
        id: randomUUID(),
        scenario,
        mode: "off",
        confidenceThreshold: null,
        model: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      };
      this.policies.set(policy.id, policy);
    }
    if (patch.mode !== undefined) policy.mode = patch.mode;
    if (patch.confidenceThreshold !== undefined) {
      policy.confidenceThreshold = patch.confidenceThreshold;
    }
    if (patch.model !== undefined) policy.model = patch.model;
    if (patch.updatedBy !== undefined) policy.updatedBy = patch.updatedBy;
    policy.updatedAt = now;

    let row: PolicyChangeRecord | null = null;
    if (change) row = await this.appendPolicyChange(change);
    return { policy, change: row };
  }

  async appendPolicyChange(
    input: PolicyChangeInsert,
  ): Promise<PolicyChangeRecord> {
    const row: PolicyChangeRecord = {
      id: input.id ?? randomUUID(),
      scenario: input.scenario,
      field: input.field,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      actor: input.actor,
      reason: input.reason ?? null,
      createdAt: nowIso(),
    };
    this.policyChanges.set(row.id, row);
    return row;
  }

  async listPolicyChanges(opts?: {
    scenario?: string;
    limit?: number;
    offset?: number;
  }): Promise<PolicyChangeRecord[]> {
    let all = [...this.policyChanges.values()]
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts?.scenario !== undefined) {
      all = all.filter((c) => c.scenario === opts.scenario);
    }
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }
}
