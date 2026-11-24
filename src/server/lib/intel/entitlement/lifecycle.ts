// EPIC-262 (SLICE-262-19b): entitlement lifecycle — plan assignment
// and the trial→active→past_due→expired→canceled state machine.
// Every transition is an append-only event; the record's latest state
// stays a pure function of event application. `now` is explicit
// everywhere — deterministic, no clock inside.
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import type { IntelEntitlement, IntelEntitlementStatus } from "./types";
import type { IntelEntitlementStore } from "./store";
import {
  newEntitlementEvent,
  type IntelEntitlementEventStore,
} from "./events-store";
import { planFor, planWindows, resolveCoverage } from "./plans";

const DAY_MS = 86_400_000;
const plus = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * DAY_MS).toISOString();

export interface LifecycleDeps {
  entitlements: IntelEntitlementStore;
  events: IntelEntitlementEventStore;
}

export interface Actor {
  principal: "operator" | "system";
  id: string;
}

export type TransitionAction =
  | "activate" // trial → active (first payment / manual activation)
  | "renew" // active|past_due → active (period extends)
  | "payment_failed" // active → past_due
  | "payment_recovered" // past_due → active (new period)
  | "expire" // → expired (manual; sweep derives the same)
  | "cancel"; // any → canceled (terminal — new plan, not resume)

export type TransitionResult =
  | { ok: true; entitlement: IntelEntitlement }
  | { ok: false; reason: string };

const record = async (
  deps: LifecycleDeps,
  ent: IntelEntitlement,
  actor: Actor,
  action: string,
  fromStatus: string | null,
  reason: string | null = null,
): Promise<IntelEntitlement> => {
  const saved = await deps.entitlements.upsert(ent);
  await deps.events.insert(
    newEntitlementEvent({
      tenantId: ent.tenantId,
      actor: `${actor.principal}:${actor.id}`,
      action,
      fromStatus,
      toStatus: ent.status,
      plan: ent.plan,
      reason,
      at: ent.updatedAt,
    }),
  );
  return saved;
};

/** Assign a plan — creates the tenant's entitlement or moves an
 *  existing one onto a new plan+window. Trial → status "trial";
 *  paid plans → "active" (assignment IS the access grant in v1 —
 *  payment evidence lands with the billing connector, 262-21). */
export async function assignPlan(
  deps: LifecycleDeps,
  input: {
    tenantId: string;
    planCode: string;
    coveredSiteIds?: string[];
    tenantSiteIds: string[];
    now: string;
    actor: Actor;
  },
): Promise<TransitionResult> {
  const plan = planFor(input.planCode);
  if (!plan) return { ok: false, reason: `unknown plan "${input.planCode}"` };
  const coverage = resolveCoverage(plan, input.coveredSiteIds, input.tenantSiteIds);
  if (!coverage.ok) {
    return {
      ok: false,
      reason: `plan "${plan.code}" covers at most ${plan.siteLimit} site(s)`,
    };
  }
  const existing = await deps.entitlements.getByTenant(input.tenantId);
  const w = planWindows(plan, input.now);
  const ent: IntelEntitlement = {
    id: existing?.id ?? `ent_${generateReportId()}`,
    tenantId: input.tenantId,
    plan: plan.code,
    status: plan.code === "trial" ? "trial" : "active",
    coveredSiteIds: coverage.siteIds,
    perSiteLimits: existing?.perSiteLimits ?? {},
    ...w,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  return { ok: true, entitlement: await record(deps, ent, input.actor, "assign_plan", existing?.status ?? null) };
}

/** Manual/ops transition — the state machine's explicit edges.
 *  Time-derived edges live in sweepEntitlement. `canceled` is
 *  terminal: resuming is a NEW plan assignment, not a transition. */
export async function transitionEntitlement(
  deps: LifecycleDeps,
  input: {
    tenantId: string;
    action: TransitionAction;
    now: string;
    actor: Actor;
  },
): Promise<TransitionResult> {
  const ent = await deps.entitlements.getByTenant(input.tenantId);
  if (!ent) return { ok: false, reason: "no_entitlement" };
  const plan = planFor(ent.plan);
  if (!plan) return { ok: false, reason: `entitlement references unknown plan "${ent.plan}"` };
  const { action, now } = input;
  const set = (patch: Partial<IntelEntitlement>) =>
    record(deps, { ...ent, ...patch, updatedAt: now }, input.actor, action, ent.status);

  switch (action) {
    case "activate":
      if (ent.status !== "trial") return { ok: false, reason: `cannot activate from "${ent.status}"` };
      return { ok: true, entitlement: await set({ status: "active", ...planWindows(plan, now) }) };
    case "renew": {
      if (ent.status !== "active" && ent.status !== "past_due") {
        return { ok: false, reason: `cannot renew from "${ent.status}"` };
      }
      // renew extends the current paid period if it is still running;
      // after expiry it starts a fresh period from now
      const anchor = ent.validUntil > now ? ent.validUntil : now;
      return {
        ok: true,
        entitlement: await set({
          status: "active",
          validUntil: plus(anchor, plan.periodDays),
          graceUntil: plus(anchor, plan.periodDays + plan.graceDays),
        }),
      };
    }
    case "payment_failed":
      if (ent.status !== "active") return { ok: false, reason: `payment_failed from "${ent.status}"` };
      return { ok: true, entitlement: await set({ status: "past_due" }) };
    case "payment_recovered":
      if (ent.status !== "past_due") return { ok: false, reason: `payment_recovered from "${ent.status}"` };
      return { ok: true, entitlement: await set({ status: "active", ...planWindows(plan, now) }) };
    case "expire":
      if (ent.status === "expired" || ent.status === "canceled") {
        return { ok: false, reason: `already ${ent.status}` };
      }
      return { ok: true, entitlement: await set({ status: "expired" }) };
    case "cancel":
      if (ent.status === "canceled") return { ok: false, reason: "already canceled" };
      return { ok: true, entitlement: await set({ status: "canceled" }) };
  }
}

/** Read-time honest status — mirrors sweepEntitlement's time rules
 *  WITHOUT persisting (view-time derivation, the 27a/27b pattern).
 *  The stored status stays the event-trail fact; this answers "what
 *  would a sweep do right now" for display and gating context. */
export function effectiveStatus(
  ent: IntelEntitlement,
  now: string,
): IntelEntitlementStatus {
  if (ent.status === "canceled" || ent.status === "expired") return ent.status;
  if (ent.status === "trial") {
    return now >= ent.validUntil ? "expired" : "trial";
  }
  if (ent.status === "past_due") {
    const plan = planFor(ent.plan);
    const dunningEnds = plan ? plus(ent.updatedAt, plan.pastDueDays) : null;
    return now >= ent.graceUntil || (dunningEnds !== null && now >= dunningEnds)
      ? "expired"
      : "past_due";
  }
  if (now >= ent.graceUntil) return "expired";
  if (now >= ent.validUntil) return "past_due";
  return "active";
}

/** Time-derived transitions — the automation in "automation".
 *  Callable per-tenant on any cadence (route, cron, lazy); the same
 *  honest events land in the log with actor system:*.
 *    trial  + now ≥ validUntil            → expired (no grace owed)
 *    active + validUntil ≤ now < graceUntil → past_due (payment due)
 *    active|past_due + now ≥ graceUntil   → expired
 *    past_due + now ≥ updatedAt+pastDueDays → expired (dunning out)
 *  canceled stays terminal; expired is absorbing. */
export async function sweepEntitlement(
  deps: LifecycleDeps,
  tenantId: string,
  now: string,
): Promise<{ changed: boolean; entitlement: IntelEntitlement | null }> {
  const ent = await deps.entitlements.getByTenant(tenantId);
  if (!ent || ent.status === "canceled" || ent.status === "expired") {
    return { changed: false, entitlement: ent };
  }
  const plan = planFor(ent.plan);
  const actor: Actor = { principal: "system", id: "sweep" };
  const sys = (action: string, to: IntelEntitlementStatus, reason: string) =>
    record(deps, { ...ent, status: to, updatedAt: now }, actor, action, ent.status, reason);

  if (ent.status === "trial" && now >= ent.validUntil) {
    await sys("sweep_expire", "expired", "trial window ended");
    return { changed: true, entitlement: await deps.entitlements.getByTenant(tenantId) };
  }
  if (ent.status === "past_due") {
    const dunningEnds = plan ? plus(ent.updatedAt, plan.pastDueDays) : null;
    if (now >= ent.graceUntil || (dunningEnds !== null && now >= dunningEnds)) {
      await sys("sweep_expire", "expired", "dunning window ended");
      return { changed: true, entitlement: await deps.entitlements.getByTenant(tenantId) };
    }
    return { changed: false, entitlement: ent };
  }
  // active
  if (now >= ent.graceUntil) {
    await sys("sweep_expire", "expired", "grace window ended");
    return { changed: true, entitlement: await deps.entitlements.getByTenant(tenantId) };
  }
  if (now >= ent.validUntil) {
    await sys("sweep_past_due", "past_due", "billing period ended unpaid");
    return { changed: true, entitlement: await deps.entitlements.getByTenant(tenantId) };
  }
  return { changed: false, entitlement: ent };
}
