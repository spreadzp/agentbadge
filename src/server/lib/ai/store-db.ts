/**
 * EPIC-232 (SLICE-232-1): Postgres-backed AiStore — thin adapter over
 * @agentbadge/database AiRepository (raw rows are structurally the lib
 * records; Json columns land on `unknown`/`AiUsage` by cast).
 */

import type { AiRepository } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import type {
  AiJobInsert,
  AiJobRecord,
  AiRunInsert,
  AiRunRecord,
  AiStore,
  AiUsage,
  AutomationPolicyPatch,
  AutomationPolicyRecord,
  PolicyChangeInsert,
  PolicyChangeRecord,
} from "./types";

const toRun = (r: AiRunRecord): AiRunRecord => ({
  ...r,
  output: r.output ?? null,
  usage: (r.usage as AiUsage | null) ?? null,
});

export class DbAiStore implements AiStore {
  constructor(private readonly repo: AiRepository) {}

  async appendRun(input: AiRunInsert): Promise<AiRunRecord> {
    const row = await this.repo.appendRun({
      ...input,
      output: (input.output ?? null) as JsonValue | null,
      usage: (input.usage ?? null) as JsonValue | null,
    });
    return toRun(row as unknown as AiRunRecord);
  }

  async listRuns(opts?: Parameters<AiStore["listRuns"]>[0]): Promise<AiRunRecord[]> {
    const rows = await this.repo.listRuns(opts);
    return rows.map((r) => toRun(r as unknown as AiRunRecord));
  }

  async latestRunFor(
    subjectType: string,
    subjectId: string,
    scenario?: string,
  ): Promise<AiRunRecord | null> {
    const r = await this.repo.latestRunFor(subjectType, subjectId, scenario);
    return r ? toRun(r as unknown as AiRunRecord) : null;
  }

  countRunsSince(sinceIso: string): Promise<number> {
    return this.repo.countRunsSince(sinceIso);
  }

  countProviderCallsSince(sinceIso: string): Promise<number> {
    return this.repo.countProviderCallsSince(sinceIso);
  }

  countJobsByStatus(status: string, subjectType?: string): Promise<number> {
    return this.repo.countJobsByStatus(status, subjectType);
  }

  sumTokensSince(sinceIso: string): Promise<number> {
    return this.repo.sumTokensSince(sinceIso);
  }

  async getJob(id: string): Promise<AiJobRecord | null> {
    return (await this.repo.getJob(id)) as AiJobRecord | null;
  }

  async enqueueJob(
    input: AiJobInsert,
  ): Promise<{ job: AiJobRecord; duplicate: boolean }> {
    const { job, duplicate } = await this.repo.enqueueJob(input);
    return { job: job as AiJobRecord, duplicate };
  }

  async claimJobs(opts: {
    limit: number;
    reclaimBefore: string;
    now: string;
    maxAttempts?: number;
  }): Promise<AiJobRecord[]> {
    const rows = await this.repo.claimJobs(opts);
    return rows as AiJobRecord[];
  }

  async completeJob(
    id: string,
    patch: { status: string; lastError?: string | null; runId?: string | null },
    opts?: { expectedLockedAt?: string | null },
  ): Promise<AiJobRecord | null> {
    return (await this.repo.completeJob(
      id,
      patch,
      opts,
    )) as AiJobRecord | null;
  }

  async getPolicy(scenario: string): Promise<AutomationPolicyRecord | null> {
    return (await this.repo.getPolicy(scenario)) as AutomationPolicyRecord | null;
  }

  async listPolicies(): Promise<AutomationPolicyRecord[]> {
    return (await this.repo.listPolicies()) as AutomationPolicyRecord[];
  }

  async upsertPolicy(
    scenario: string,
    patch: AutomationPolicyPatch,
    change?: PolicyChangeInsert,
  ): Promise<{ policy: AutomationPolicyRecord; change: PolicyChangeRecord | null }> {
    const { policy, change: row } = await this.repo.upsertPolicy(
      scenario,
      patch,
      change,
    );
    return {
      policy: policy as AutomationPolicyRecord,
      change: (row as PolicyChangeRecord | null) ?? null,
    };
  }

  async appendPolicyChange(
    input: PolicyChangeInsert,
  ): Promise<PolicyChangeRecord> {
    return (await this.repo.appendPolicyChange(input)) as PolicyChangeRecord;
  }

  async listPolicyChanges(opts?: {
    scenario?: string;
    limit?: number;
    offset?: number;
  }): Promise<PolicyChangeRecord[]> {
    return (await this.repo.listPolicyChanges(opts)) as PolicyChangeRecord[];
  }
}
