// EPIC-262 (SLICE-262-2): registry domain entities.
// Tenant→Customer→Site→{Domains, Environment} per D-262-Q5.
// site_id is the stable technical identity (D-262-Q9): domain changes
// never rewrite it; site_key is a separate revocable credential.

export type SiteEnvironment = "production" | "staging" | "development";
export const SITE_ENVIRONMENTS: readonly SiteEnvironment[] = [
  "production",
  "staging",
  "development",
];

export interface IntelTenant {
  id: string; // tnt_<ulid>
  slug: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface IntelCustomer {
  id: string; // cus_<ulid>
  tenantId: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface IntelSite {
  id: string; // site_<ulid> — stable across domain moves
  customerId: string;
  environment: SiteEnvironment;
  status: "active" | "suspended" | "deleted";
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface IntelDomain {
  id: string; // dom_<ulid>
  siteId: string;
  hostname: string; // globally unique
  isPrimary: boolean;
  status: "active" | "removed";
  createdAt: string; // ISO
}

// Only hash+prefix are ever persisted — plaintext leaves in the mint
// response exactly once.
export interface IntelSiteKey {
  id: string; // key_<ulid>
  siteId: string;
  keyHash: string; // sha256 hex of plaintext
  keyPrefix: string; // "absk_" + 8 — identification only
  status: "active" | "revoked";
  rotatedFromId: string | null; // rotation lineage
  createdAt: string; // ISO
  revokedAt: string | null;
}

// D-262-Q9: two INDEPENDENT ownership scopes — never merged.
export type OwnershipKind = "installation_control" | "domain_control";
export const OWNERSHIP_KINDS: readonly OwnershipKind[] = [
  "installation_control",
  "domain_control",
];
// v1 allowlist — meta-tag/file methods are explicitly out (AC #6).
export type OwnershipMethod = "plugin_handshake" | "dns_txt";
export const OWNERSHIP_METHODS: readonly OwnershipMethod[] = [
  "plugin_handshake",
  "dns_txt",
];
export type OwnershipStatus = "pending" | "verified" | "expired" | "revoked";

export interface IntelOwnershipProof {
  id: string; // own_<ulid>
  siteId: string;
  kind: OwnershipKind;
  method: OwnershipMethod;
  status: OwnershipStatus;
  verifiedAt: string | null;
  reverifyAfter: string | null;
  domainId: string | null; // set for domain_control proofs
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// ─── SLICE-262-7: operators — humans attached to a tenant with roles.
// Site owner ≠ operator ≠ tenant (EXPLAINED §0): the operator key is
// a tenant-scoped credential, not a site credential.
export const OPERATOR_ROLES = ["owner", "operator", "viewer"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export interface IntelOperator {
  id: string; // op_<ulid>
  tenantId: string;
  email: string;
  role: OperatorRole;
  status: "active" | "revoked";
  keyHash: string; // sha256 hex of plaintext
  keyPrefix: string; // "abop_" + 8 — identification only
  createdAt: string; // ISO
  revokedAt: string | null;
}

export interface OperatorAuthContext {
  operator_id: string;
  tenant_id: string;
  role: OperatorRole;
}
