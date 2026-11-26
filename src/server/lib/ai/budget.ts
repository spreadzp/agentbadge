/**
 * EPIC-232 (SLICE-232-1, D-232-7): budget guards.
 *
 * Two meters over the append-only AiRun stream (non-skipped rows =
 * real provider calls): daily call count (UTC day) and monthly USD
 * estimate (Σ tokensTotal × AI_USD_PER_1M_TOKENS / 1e6).
 *
 * States:
 *   ok          — everything runs
 *   shadow_cut  — within AI_SHADOW_RESERVE_CALLS of the daily cap:
 *                 shadow-mode calls are cut first; assist/supervised
 *                 keep the reserve
 *   exhausted   — daily cap hit OR monthly estimate ≥ cap: effective
 *                 mode degrades to `off` for every scenario
 *
 * Degradation is an EFFECTIVE-MODE OVERLAY: the stored AutomationPolicy
 * is never rewritten by the guard (operator intent survives the window
 * reset); the guard appends PolicyChange{actor:"budget-guard"} so the
 * auto-degradation is audited, plus one Telegram alert per incident.
 */

import type { AiEnvConfig } from "../../../config/env/ai-types";

import type { AiAlertSender } from "./alerts";
import type { AiStore } from "./types";

export type BudgetStateName = "ok" | "shadow_cut" | "exhausted";

export interface BudgetState {
  state: BudgetStateName;
  dailyCalls: number;
  monthlyUsdEstimate: number;
}

export function utcDayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

export function utcMonthStart(now: Date): string {
  return `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`;
}

export async function checkBudget(
  store: AiStore,
  cfg: Pick<
    AiEnvConfig,
    | "dailyCallLimit"
    | "monthlyBudgetUsd"
    | "usdPer1MTokens"
    | "shadowReserveCalls"
    | "subjectDailyCallLimit"
  >,
  now: Date = new Date(),
  /** Delta-3 H-8: partition check — the caller's stream is metered
   *  against its OWN daily share; other streams' floods can't
   *  exhaust it. */
  subjectType?: string,
): Promise<BudgetState> {
  // 232-12 H-8: the daily meter counts real provider calls only —
  // error/skipped rows never reached the LLM and must not burn the
  // budget (a provider outage would otherwise self-lock the day).
  const dailyCalls = await store.countProviderCallsSince(utcDayStart(now));
  const tokens = await store.sumTokensSince(utcMonthStart(now));
  const monthlyUsdEstimate = (tokens / 1e6) * cfg.usdPer1MTokens;

  const callsExhausted =
    cfg.dailyCallLimit > 0 && dailyCalls >= cfg.dailyCallLimit;
  const usdExhausted =
    cfg.monthlyBudgetUsd > 0 && monthlyUsdEstimate >= cfg.monthlyBudgetUsd;
  // Delta-3: per-subjectType partition — the stream's own meter,
  // not the global one. An agent_request flood hits ITS cap while
  // review_case keeps its share of the day.
  let subjectExhausted = false;
  if (
    subjectType !== undefined &&
    cfg.subjectDailyCallLimit !== undefined &&
    cfg.subjectDailyCallLimit > 0
  ) {
    const subjectCalls = await store.countProviderCallsSince(
      utcDayStart(now),
      subjectType,
    );
    subjectExhausted = subjectCalls >= cfg.subjectDailyCallLimit;
  }
  if (callsExhausted || usdExhausted || subjectExhausted) {
    return { state: "exhausted", dailyCalls, monthlyUsdEstimate };
  }
  if (
    cfg.dailyCallLimit > 0 &&
    cfg.shadowReserveCalls > 0 &&
    dailyCalls >= cfg.dailyCallLimit - cfg.shadowReserveCalls
  ) {
    return { state: "shadow_cut", dailyCalls, monthlyUsdEstimate };
  }
  return { state: "ok", dailyCalls, monthlyUsdEstimate };
}

/**
 * Effective automation mode for a declared policy mode under the
 * current kill/budget gates. `AI_AUTOMATION_ENABLED=false` and
 * `exhausted` both resolve to "off"; `shadow_cut` additionally folds
 * shadow → off while assist/supervised keep running.
 */
export function resolveEffectiveMode(
  declaredMode: string,
  opts: { enabled: boolean; budget: BudgetStateName },
): string {
  if (!opts.enabled) return "off";
  if (declaredMode === "off") return "off";
  if (opts.budget === "exhausted") return "off";
  if (opts.budget === "shadow_cut" && declaredMode === "shadow") return "off";
  return declaredMode;
}

const defaultDegradedSet = new Set<string>();

/** Test hook. */
export function resetBudgetDegraded(): void {
  defaultDegradedSet.clear();
}

/**
 * Audit + alert for a budget-driven degradation. Writes ONE
 * PolicyChange(actor=budget-guard) per scenario per UTC day
 * (process-level dedupe — a restart may duplicate a row, which is
 * acceptable audit noise) and fires the TG alert once per day.
 */
export async function applyBudgetDegradation(
  store: AiStore,
  declaredMode: string,
  scenario: string,
  budget: BudgetState,
  cfg: Pick<AiEnvConfig, "dailyCallLimit" | "monthlyBudgetUsd">,
  alert: AiAlertSender,
  now: Date = new Date(),
  degraded: Set<string> = defaultDegradedSet,
): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const key = `${scenario}:${day}`;
  if (degraded.has(key)) return;
  degraded.add(key);
  await store.appendPolicyChange({
    scenario,
    field: "mode",
    oldValue: declaredMode,
    newValue: "off",
    actor: "budget-guard",
    reason:
      `budget_exhausted: ${budget.dailyCalls}/${cfg.dailyCallLimit} calls, ` +
      `~$${budget.monthlyUsdEstimate.toFixed(4)}/$${cfg.monthlyBudgetUsd}`,
  });
  await alert(
    "ai-budget",
    `AI budget exhausted — automation degraded to off\n` +
      `calls today: ${budget.dailyCalls}/${cfg.dailyCallLimit}\n` +
      `est. month spend: ~$${budget.monthlyUsdEstimate.toFixed(4)}/$${cfg.monthlyBudgetUsd}\n` +
      `scenario hit: ${scenario} (declared ${declaredMode})`,
  );
}
