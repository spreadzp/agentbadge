// EPIC-262 (SLICE-262-19a): pure entitlement decision — D-262-Q8
// expiry model: valid window → grace (allowed + warning) → soft-off
// (deny paid ops; dashboard read-only/export handled elsewhere).
// `now` is an explicit ISO string — deterministic, no clock inside.

import type {
  EntitlementDecision,
  IntelEntitlement,
  IntelPaidOperation,
} from "./types";

export function checkEntitlement(
  ent: IntelEntitlement | null,
  op: IntelPaidOperation,
  siteId: string,
  now: string,
): EntitlementDecision {
  void op; // per-op policy lands with 19b; every paid op is gated alike in 19a
  if (!ent) return { allowed: false, reason: "no_entitlement" };
  if (ent.status === "canceled") return { allowed: false, reason: "canceled" };
  if (ent.status === "expired") return { allowed: false, reason: "expired" };
  if (now < ent.validFrom) return { allowed: false, reason: "not_yet_valid" };
  if (now >= ent.graceUntil) return { allowed: false, reason: "soft_off" };
  if (ent.coveredSiteIds.length > 0 && !ent.coveredSiteIds.includes(siteId)) {
    return { allowed: false, reason: "site_not_covered" };
  }
  if (now >= ent.validUntil) {
    return { allowed: true, phase: "grace", warning: "in_grace" };
  }
  return { allowed: true, phase: ent.status === "trial" ? "trial" : "active" };
}
