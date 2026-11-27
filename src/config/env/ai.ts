/**
 * AI automation env section — EPIC-232, SLICE-232-1.
 *
 * AI_AUTOMATION_ENABLED=true is the master switch AND the emergency
 * kill (D-232-3): absent/anything-else disables all provider calls —
 * worker drains jobs to `skipped` and never reaches the network.
 *
 * Budget guards (D-232-7):
 *   AI_DAILY_CALL_LIMIT     — provider calls per UTC day (0 = unlimited)
 *   AI_MONTHLY_BUDGET_USD   — estimated spend cap per UTC month (0 = off)
 *   AI_USD_PER_1M_TOKENS    — rate converting usage.total → USD
 *   AI_SHADOW_RESERVE_CALLS — reserve held for assist/supervised;
 *     shadow calls are cut first once the reserve threshold is hit.
 *
 * Provider seam (D-232-1): AI_BASE_URL / AI_API_KEY / AI_MODEL select
 * the OpenAI-compatible endpoint — one contract covers OpenAI,
 * OpenRouter, local vLLM/Ollama. Missing key/url → jobs error-open
 * (manual path keeps working); no boot crash.
 */

import { AI_SUBJECT_STREAMS, type AiEnvConfig } from "./ai-types";
import { booleanFlag } from "./validators";

function intVar(
  name: string,
  fallback: number,
  min: number,
  errors: string[],
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    errors.push(`Invalid ${name}: expected integer >= ${min}, got "${raw}"`);
    return fallback;
  }
  return n;
}

function numVar(
  name: string,
  fallback: number,
  min: number,
  errors: string[],
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    errors.push(`Invalid ${name}: expected number >= ${min}, got "${raw}"`);
    return fallback;
  }
  return n;
}

export function loadAi(errors: string[]): AiEnvConfig | undefined {
  if (!booleanFlag("AI_AUTOMATION_ENABLED")) return undefined;

  const baseUrl = (process.env.AI_BASE_URL ?? "https://api.openai.com").replace(
    /\/+$/,
    "",
  );
  const apiKey = process.env.AI_API_KEY?.trim() || undefined;
  const model = process.env.AI_MODEL?.trim() || "gpt-4o-mini";

  const jsonModeRaw = (process.env.AI_JSON_MODE ?? "schema").toLowerCase();
  const jsonMode = (
    jsonModeRaw === "object" || jsonModeRaw === "none" ? jsonModeRaw : "schema"
  ) as AiEnvConfig["jsonMode"];
  if (!["schema", "object", "none"].includes(jsonModeRaw)) {
    errors.push(
      `Invalid AI_JSON_MODE: expected schema|object|none, got "${process.env.AI_JSON_MODE}" — using "schema"`,
    );
  }

  const dailyCallLimit = intVar("AI_DAILY_CALL_LIMIT", 500, 0, errors);
  const monthlyBudgetUsd = numVar("AI_MONTHLY_BUDGET_USD", 0, 0, errors);
  const usdPer1MTokens = numVar("AI_USD_PER_1M_TOKENS", 1.0, 0, errors);
  const shadowReserveCalls = intVar("AI_SHADOW_RESERVE_CALLS", 20, 0, errors);

  const timeoutMs = intVar("AI_TIMEOUT_MS", 30_000, 1_000, errors);
  // "0"/"false" disables; unset → on (D-232-7 timeout + 1 retry).
  const retryOnce = !["0", "false"].includes(
    (process.env.AI_RETRY_ONCE ?? "1").toLowerCase(),
  );

  const workerEnabled = !["0", "false"].includes(
    (process.env.AI_WORKER_ENABLED ?? "1").toLowerCase(),
  );
  const workerIntervalMs = intVar("AI_WORKER_INTERVAL_MS", 5_000, 500, errors);
  const jobLeaseMs = intVar("AI_JOB_LEASE_MS", 120_000, 5_000, errors);
  const jobMaxAttempts = intVar("AI_JOB_MAX_ATTEMPTS", 3, 1, errors);
  const jobQueueCap = intVar("AI_JOB_QUEUE_CAP", 500, 10, errors);
  // Delta-4 H-8: unset → derived floor(daily/N_STREAMS) so the
  // partition is ON in stock deploys; explicit 0 opts out.
  const subjectLimitRaw = process.env.AI_SUBJECT_DAILY_LIMIT;
  const subjectDailyCallLimit =
    subjectLimitRaw === undefined || subjectLimitRaw === ""
      ? dailyCallLimit > 0
        ? Math.floor(dailyCallLimit / AI_SUBJECT_STREAMS.length)
        : 0
      : intVar("AI_SUBJECT_DAILY_LIMIT", 0, 0, errors);
  // Isolation invariant: (N_STREAMS - 1) saturated streams must not
  // reach the global daily cap, or a multi-stream flood still
  // starves the remaining stream.
  if (
    subjectDailyCallLimit > 0 &&
    dailyCallLimit > 0 &&
    subjectDailyCallLimit * (AI_SUBJECT_STREAMS.length - 1) >=
      dailyCallLimit
  ) {
    errors.push(
      `AI_SUBJECT_DAILY_LIMIT=${subjectDailyCallLimit} breaks ` +
        `stream isolation: ${AI_SUBJECT_STREAMS.length - 1} flooded ` +
        `streams can exhaust AI_DAILY_CALL_LIMIT=${dailyCallLimit} ` +
        `(need < ${Math.ceil(dailyCallLimit / (AI_SUBJECT_STREAMS.length - 1))})`,
    );
  }

  return {
    enabled: true,
    baseUrl,
    apiKey,
    model,
    jsonMode,
    dailyCallLimit,
    monthlyBudgetUsd,
    usdPer1MTokens,
    shadowReserveCalls,
    timeoutMs,
    retryOnce,
    workerEnabled,
    workerIntervalMs,
    jobLeaseMs,
    jobMaxAttempts,
    jobQueueCap,
    subjectDailyCallLimit,
  };
}
