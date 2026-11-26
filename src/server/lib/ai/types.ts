/**
 * EPIC-232 (SLICE-232-1, D-232-2/3/8): AI automation domain types —
 * the store contract shared by the Postgres adapter (store-db.ts over
 * @agentbadge/database AiRepository) and the in-memory fallback
 * (store-memory.ts). ISO-8601 string timestamps throughout (store
 * convention — serialized rows, never Date objects).
 */

/** O3 (decisions.md): technical scenario keys for spec slices E1–E6.
 *  E7 is a MODE (shadow), E8/E9/E10 are surfaces — not job scenarios. */
export const AI_SCENARIOS = [
  "classification", // E1 — intake request classification
  "summary", // E2 — intake request summary
  "knowledge_search", // E3 — LLM query over the knowledge store
  "answer_draft", // E4 — draft answer (never auto-sent)
  "feedback_extract", // E5 — structured feedback extraction
  "review_assist", // E6 — review-case assistant
] as const;
export type AiScenario = (typeof AI_SCENARIOS)[number];

/** D-232-3 automation modes. `auto` is deliberately absent in v1. */
export const AI_MODES = ["off", "shadow", "assist", "supervised"] as const;
export type AiMode = (typeof AI_MODES)[number];

export const AI_RUN_STATUSES = [
  "success",
  "invalid_json",
  "timeout",
  "error",
  "skipped",
] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_JOB_STATUSES = [
  "queued",
  "working",
  "done",
  "failed",
  "skipped",
] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

/** Token usage as reported by the provider (OpenAI-compatible shape). */
export interface AiUsage {
  prompt?: number;
  completion?: number;
  total?: number;
}

export interface AiRunRecord {
  id: string;
  scenario: string;
  subjectType: string;
  subjectId: string;
  /** Effective automation mode when the call was decided (D-232-2). */
  modeAtTime: string;
  inputRef: string | null;
  inputHash: string | null;
  output: unknown;
  confidence: number | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  usage: AiUsage | null;
  tokensTotal: number | null;
  latencyMs: number | null;
  status: string;
  error: string | null;
  jobId: string | null;
  createdAt: string;
}

export interface AiRunInsert {
  id?: string;
  scenario: string;
  subjectType: string;
  subjectId: string;
  modeAtTime: string;
  inputRef?: string | null;
  inputHash?: string | null;
  output?: unknown;
  confidence?: number | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  usage?: AiUsage | null;
  tokensTotal?: number | null;
  latencyMs?: number | null;
  status: string;
  error?: string | null;
  jobId?: string | null;
}

export interface AiJobRecord {
  id: string;
  scenario: string;
  subjectType: string;
  subjectId: string;
  inputRef: string | null;
  inputHash: string | null;
  idempotencyKey: string | null;
  status: string;
  attempts: number;
  lockedAt: string | null;
  lastError: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiJobInsert {
  id?: string;
  scenario: string;
  subjectType: string;
  subjectId: string;
  inputRef?: string | null;
  inputHash?: string | null;
  idempotencyKey?: string | null;
}

export interface AutomationPolicyRecord {
  id: string;
  scenario: string;
  mode: string;
  confidenceThreshold: number | null;
  model: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationPolicyPatch {
  mode?: string;
  confidenceThreshold?: number | null;
  model?: string | null;
  updatedBy?: string | null;
}

export interface PolicyChangeRecord {
  id: string;
  scenario: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string;
  reason: string | null;
  createdAt: string;
}

export interface PolicyChangeInsert {
  id?: string;
  scenario: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  actor: string;
  reason?: string | null;
}

/**
 * The store contract — Postgres (store-db over AiRepository) and
 * in-memory implementations are behavior-identical by the parity
 * tests. Async throughout: the PG repo is async, so the memory one
 * is too (same call shapes).
 */
export interface AiStore {
  // AiRun — append-only
  appendRun(input: AiRunInsert): Promise<AiRunRecord>;
  listRuns(opts?: {
    subjectType?: string;
    subjectId?: string;
    scenario?: string;
    modeAtTime?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<AiRunRecord[]>;
  latestRunFor(
    subjectType: string,
    subjectId: string,
    scenario?: string,
  ): Promise<AiRunRecord | null>;
  /** Non-skipped runs since ISO ts — daily call meter (D-232-7). */
  countRunsSince(sinceIso: string): Promise<number>;
  /** Sum of tokensTotal since ISO ts — monthly USD meter. */
  sumTokensSince(sinceIso: string): Promise<number>;

  // AiJob — outbox
  getJob(id: string): Promise<AiJobRecord | null>;
  enqueueJob(
    input: AiJobInsert,
  ): Promise<{ job: AiJobRecord; duplicate: boolean }>;
  /**
   * Atomic claim: queued rows + `working` rows locked before
   * `reclaimBefore`; sets status=working, lockedAt=now, attempts++.
   */
  claimJobs(opts: {
    limit: number;
    reclaimBefore: string;
    now: string;
  }): Promise<AiJobRecord[]>;
  completeJob(
    id: string,
    patch: { status: string; lastError?: string | null; runId?: string | null },
  ): Promise<AiJobRecord | null>;

  // AutomationPolicy + PolicyChange
  getPolicy(scenario: string): Promise<AutomationPolicyRecord | null>;
  listPolicies(): Promise<AutomationPolicyRecord[]>;
  /** Policy upsert + audit row — one logical write (D-232-3). */
  upsertPolicy(
    scenario: string,
    patch: AutomationPolicyPatch,
    change?: PolicyChangeInsert,
  ): Promise<{ policy: AutomationPolicyRecord; change: PolicyChangeRecord | null }>;
  appendPolicyChange(input: PolicyChangeInsert): Promise<PolicyChangeRecord>;
  listPolicyChanges(opts?: {
    scenario?: string;
    limit?: number;
    offset?: number;
  }): Promise<PolicyChangeRecord[]>;
}
