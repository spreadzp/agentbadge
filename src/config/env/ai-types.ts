/**
 * AI automation config (EPIC-232, SLICE-232-1; D-232-1/3/7).
 * Present only when AI_AUTOMATION_ENABLED=true; absent = feature off
 * (master kill-switch — unsetting is the emergency stop).
 */
export interface AiEnvConfig {
  enabled: boolean;
  /** OpenAI-compatible base URL (AI_BASE_URL, default https://api.openai.com). */
  baseUrl: string;
  /** Bearer key (AI_API_KEY). Absent → provider seams no-op (fail-open). */
  apiKey?: string;
  /** Default model (AI_MODEL). Per-scenario override: AutomationPolicy.model. */
  model: string;
  /**
   * Structured-output mode for response_format (AI_JSON_MODE):
   * "schema" = OpenAI json_schema (default), "object" = json_object
   * (DeepSeek — schema travels in the prompt instead), "none" = omit
   * response_format entirely and rely on prompt + JSON.parse check.
   */
  jsonMode?: "schema" | "object" | "none";
  /** Max provider calls per UTC day (AI_DAILY_CALL_LIMIT, 0 = unlimited). */
  dailyCallLimit: number;
  /** Monthly spend cap USD (AI_MONTHLY_BUDGET_USD, 0 = unlimited). */
  monthlyBudgetUsd: number;
  /** Estimated USD per 1M tokens for the budget meter (AI_USD_PER_1M_TOKENS). */
  usdPer1MTokens: number;
  /**
   * Calls kept in reserve for assist/supervised — shadow-mode calls are
   * skipped once (dailyLimit - reserve) is hit (D-232-7 shadow cut first).
   */
  shadowReserveCalls: number;
  /** Provider call timeout ms (AI_TIMEOUT_MS, default 30000). */
  timeoutMs: number;
  /** One retry with backoff on transient failure (AI_RETRY_ONCE, default on). */
  retryOnce: boolean;
  /** Outbox worker gate (AI_WORKER_ENABLED, default on when section present). */
  workerEnabled: boolean;
  /** Drain interval ms (AI_WORKER_INTERVAL_MS, default 5000). */
  workerIntervalMs: number;
  /** Job claim lease ms — crashed drains become reclaimable (AI_JOB_LEASE_MS). */
  jobLeaseMs: number;
  /** Max claim attempts before a job is marked failed (AI_JOB_MAX_ATTEMPTS). */
  jobMaxAttempts: number;
  /** 232-12 H-8: queue-depth cap — an intake flood beyond this many
   *  queued jobs stops enqueuing (unbounded backlog = unbounded
   *  provider-call liability). AI_JOB_QUEUE_CAP, default 500. */
  jobQueueCap: number;
  /** Delta-4 H-8: per-subjectType daily provider-call share. Derived
   *  from dailyCallLimit when unset (floor(daily/N_STREAMS)); an
   *  explicit 0 disables the partition. Load-time invariant:
   *  limit * (N_STREAMS - 1) must stay below dailyCallLimit or two
   *  flooded streams can still exhaust the whole day. */
  subjectDailyCallLimit: number;
}

/** Delta-4 H-8: the known AI subject streams the daily partition
 *  covers — one daily-call share each. Adding a stream without
 *  widening the invariant count weakens the isolation guarantee. */
export const AI_SUBJECT_STREAMS = [
  "agent_request",
  "feedback",
  "review_case",
] as const;
