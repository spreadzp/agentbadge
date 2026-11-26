/**
 * EPIC-232 (SLICE-232-8): in-memory AutomationPolicy +
 * PolicyChange section of {@link InMemoryAiStore} — split for the
 * 300-line cap. Same semantics as the Postgres adapter: upsert
 * with a same-call audit append (policy + change land atomically
 * from the caller's perspective).
 */

import { randomUUID } from "node:crypto";

import type {
  AutomationPolicyPatch,
  AutomationPolicyRecord,
  PolicyChangeInsert,
  PolicyChangeRecord,
} from "./types";

const nowIso = () => new Date().toISOString();

export class InMemoryAiPolicyStore {
  private readonly policies = new Map<string, AutomationPolicyRecord>();
  private readonly policyChanges = new Map<string, PolicyChangeRecord>();

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
  ): Promise<{
    policy: AutomationPolicyRecord;
    change: PolicyChangeRecord | null;
  }> {
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
