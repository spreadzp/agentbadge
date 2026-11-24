// EPIC-262 (SLICE-262-19b): plan catalog — the first real meaning of
// `ent.plan` (19a carried an operator-managed freeform code). A plan
// fixes the commercial shape: how many sites it covers and the billing
// windows the lifecycle computes from. Prices stay out of scope —
// this catalog governs ENTITLEMENT semantics, not invoicing (262-21).
export interface IntelPlan {
  code: string;
  /** max sites coveredSiteIds may carry; coverage beyond → invalid */
  siteLimit: number;
  /** paid period length in days (validFrom → validUntil) */
  periodDays: number;
  /** soft-off grace after validUntil (ops allowed + warning) */
  graceDays: number;
  /** dunning window for past_due recovery before auto-expire */
  pastDueDays: number;
}

export const INTEL_PLANS: readonly IntelPlan[] = [
  { code: "trial", siteLimit: 1, periodDays: 30, graceDays: 0, pastDueDays: 0 },
  { code: "pilot", siteLimit: 5, periodDays: 30, graceDays: 7, pastDueDays: 14 },
  { code: "studio", siteLimit: 25, periodDays: 30, graceDays: 7, pastDueDays: 14 },
] as const;

export const planFor = (code: string): IntelPlan | null =>
  INTEL_PLANS.find((p) => p.code === code) ?? null;

const DAY_MS = 86_400_000;
const plus = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * DAY_MS).toISOString();

export interface PlanWindows {
  validFrom: string;
  validUntil: string;
  graceUntil: string;
}

/** Billing windows for a fresh period starting at `now`. */
export function planWindows(plan: IntelPlan, now: string): PlanWindows {
  return {
    validFrom: now,
    validUntil: plus(now, plan.periodDays),
    graceUntil: plus(now, plan.periodDays + plan.graceDays),
  };
}

export type CoverageResult =
  | { ok: true; siteIds: string[] }
  | { ok: false; reason: "over_limit" };

/** Explicit ids win; otherwise auto-cover the tenant's sites up to
 *  the plan limit — deterministic order (createdAt, id) so the same
 *  tenant+plan always yields the same coverage. */
export function resolveCoverage(
  plan: IntelPlan,
  requested: string[] | undefined,
  tenantSiteIds: string[],
): CoverageResult {
  const ids =
    requested !== undefined
      ? requested
      : tenantSiteIds.slice(0, plan.siteLimit);
  return ids.length <= plan.siteLimit
    ? { ok: true, siteIds: ids }
    : { ok: false, reason: "over_limit" };
}
