// EPIC-264 (SLICE-264-1): admin principal model — operator ≠
// credential (C1/C11), principalType is a security boundary, not a
// label (D-264-Q20, C11). Mirrors the package row shapes
// (@agentbadge/database adminOperators group) — kept local like the
// intel registry types so the server compiles against any installed
// package version.

export type AdminPrincipalType = "human" | "service" | "break_glass";
export const ADMIN_PRINCIPAL_TYPES: readonly AdminPrincipalType[] = [
  "human",
  "service",
  "break_glass",
];

/** Closed capability vocab — scoped power on a credential (C7). */
export const ADMIN_CAPABILITIES = [
  "read",
  "probe",
  "workflow",
  "operator-admin",
] as const;
export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];

export interface AdminOperator {
  id: string; // op_<ulid>
  displayName: string;
  principalType: AdminPrincipalType;
  capabilities: string[]; // ⊆ ADMIN_CAPABILITIES
  status: "active" | "disabled";
  createdAt: string; // ISO
  disabledAt: string | null; // ISO
}

export interface AdminOperatorCredential {
  id: string; // opc_<ulid>
  operatorId: string;
  keyHash: string; // sha256 hex of opk_ plaintext — never plaintext
  keyPrefix: string; // "opk_"+8 — identification only
  status: "active" | "revoked";
  issuedAt: string; // ISO
  revokedAt: string | null; // ISO
  lastUsedAt: string | null; // ISO — diagnostics, not auth
}

/** The authenticated actor resolved FROM a credential — the thing
 *  admin surfaces put in context and audit rows (D-264-Q20). */
export interface Principal {
  id: string; // op_<ulid> or a synthetic id (break_glass — D-264-Q18)
  principalType: AdminPrincipalType;
  /** credential identification prefix — diagnostics, not a secret */
  keyPrefix: string | null;
}
