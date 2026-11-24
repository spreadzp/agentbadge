// EPIC-262 (SLICE-262-21): signal → lifecycle. Applies a verified
// BillingSignal via the 19b machinery — the same transitions an
// operator would run manually, recorded with actor `system:billing`.
// Dedupe by provider:externalId (webhooks retry) — process-local;
// the event's external_ref makes the audit trail visible.
import {
  assignPlan,
  transitionEntitlement,
  type LifecycleDeps,
} from "../entitlement";
import type { BillingSignal } from "./types";

export interface BillingDeps extends LifecycleDeps {
  tenantSiteIds(tenantId: string): Promise<string[]>;
}

export type HandleResult =
  | { applied: true; entitlement: unknown }
  | { applied: false; reason: string };

export async function handleBillingSignal(
  deps: BillingDeps,
  provider: string,
  signal: BillingSignal,
): Promise<HandleResult> {
  if (signal.effect.kind === "ignore") {
    return { applied: false, reason: signal.effect.reason };
  }
  if (!signal.tenantId) return { applied: false, reason: "no_tenant_binding" };
  const actor = { principal: "system" as const, id: `billing:${provider}` };
  const now = signal.occurredAt;
  if (signal.effect.kind === "assign_plan") {
    const r = await assignPlan(deps, {
      tenantId: signal.tenantId,
      planCode: signal.effect.planCode,
      tenantSiteIds: await deps.tenantSiteIds(signal.tenantId),
      now,
      actor,
    });
    return r.ok
      ? { applied: true, entitlement: r.entitlement }
      : { applied: false, reason: r.reason };
  }
  const r = await transitionEntitlement(deps, {
    tenantId: signal.tenantId,
    action: signal.effect.action,
    now,
    actor,
  });
  return r.ok
    ? { applied: true, entitlement: r.entitlement }
    : { applied: false, reason: r.reason };
}
