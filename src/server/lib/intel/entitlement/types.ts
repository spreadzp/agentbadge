// EPIC-262 (SLICE-262-19a): entitlement domain types — the right to
// run paid operations, attached to the Tenant (D-262-Q7: entitlement
// ≠ site_key ≠ consent — three independent axes). Status vocabulary
// is aligned with the 19b lifecycle (trial→active→past_due→expired→
// canceled); 19a manages transitions manually.

export const INTEL_PAID_OPERATIONS = [
  "deep_scan",
  "inside_diagnostics",
  "fix_apply",
  "report_diff",
] as const;
export type IntelPaidOperation = (typeof INTEL_PAID_OPERATIONS)[number];

export const INTEL_ENTITLEMENT_STATUSES = [
  "trial",
  "active",
  "past_due",
  "expired",
  "canceled",
] as const;
export type IntelEntitlementStatus =
  (typeof INTEL_ENTITLEMENT_STATUSES)[number];

export interface IntelEntitlement {
  id: string; // ent_<ulid>
  tenantId: string;
  /** operator-managed plan code — no catalog yet (19b) */
  plan: string;
  status: IntelEntitlementStatus;
  /** explicit site coverage; empty = all tenant sites allowed */
  coveredSiteIds: string[];
  /** stored limits (e.g. {deep_scan_per_day: 5}); enforcement lands
   *  with usage counters later — the contract carries them now */
  perSiteLimits: Record<string, number>;
  validFrom: string; // ISO
  validUntil: string; // ISO — end of the paid period
  graceUntil: string; // ISO — soft-off boundary (D-262-Q8)
  createdAt: string;
  updatedAt: string;
}

// The caller-facing answer to "is this operation allowed". The backend
// evaluates on EVERY paid operation — never UI, cache, or plugin.
export type EntitlementDecision =
  | { allowed: true; phase: "trial" | "active"; warning?: undefined }
  | { allowed: true; phase: "grace"; warning: "in_grace" }
  | {
      allowed: false;
      reason:
        | "no_entitlement"
        | "not_yet_valid"
        | "soft_off"
        | "expired"
        | "canceled"
        | "site_not_covered";
    };
