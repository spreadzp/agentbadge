// EPIC-262 (SLICE-262-8): consent — permission for a specific action,
// independent of entitlement and site_key (D-262-Q7). Consent
// revocation stops paid operations even while the subscription is
// alive (D-262-Q8 priority order).
//
// v1 grants are per-site per-kind upserts (latest state wins, like
// ownership proofs); SLICE-262-23 adds the full kind matrix +
// append-only history.

export const CONSENT_KINDS = [
  "audit",
  "inside_diagnostics",
  "apply",
  "publication",
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export type ConsentStatus = "granted" | "revoked";

/** Who granted/revoked — the principal, not a free-form string. */
export type ConsentPrincipal = "site_key" | "operator";

export interface IntelConsent {
  id: string; // con_<ulid>
  siteId: string;
  kind: ConsentKind;
  status: ConsentStatus;
  grantedByPrincipal: ConsentPrincipal;
  /** site_key_id | operator_id of the granting/revoking call */
  grantedById: string;
  grantedAt: string; // ISO
  revokedAt: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Append-only consent lifecycle event (SLICE-262-23) — the audit
 *  trail the upserted row cannot carry. Written on every grant and
 *  every revoke, including no-op transitions (a re-assertion is
 *  still a fact about what a principal did). */
export interface IntelConsentEvent {
  id: string; // cev_<ulid>
  siteId: string;
  kind: ConsentKind;
  action: ConsentStatus; // "granted" | "revoked"
  principal: ConsentPrincipal;
  principalId: string;
  at: string; // ISO
}
