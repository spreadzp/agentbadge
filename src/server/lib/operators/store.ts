// EPIC-264 (SLICE-264-1): operator store contract — the Postgres
// adapter (package adminOperators repos) and the memory store share
// semantics (KnowledgeStore precedent, D-143/D-229-1).
//
// MUST share: operator ≠ credential (C1) — credential lifecycle never
// rewrites operator identity; validation invariants live in the domain
// ops layer (ops.ts) so memory and Postgres reject identically;
// honest signals (`ok:false` + typed reason, no throws for expected
// refusals); keyHash is sha256-hex only — plaintext never reaches the
// store; auth lookups return the (operator, credential) pair so the
// caller decides what each status means.

import type {
  AdminOperator,
  AdminOperatorCredential,
  AdminPrincipalType,
} from "./types";

// ---------- Narrow repos (mirror of package adminOperators group) ----------

export interface AdminOperatorsRepo {
  insert(o: AdminOperator): Promise<AdminOperator>;
  byId(id: string): Promise<AdminOperator | null>;
  list(opts?: {
    status?: AdminOperator["status"];
    principalType?: AdminPrincipalType;
  }): Promise<AdminOperator[]>;
  update(o: AdminOperator): Promise<AdminOperator>;
  countActiveHumans(): Promise<number>;
}

export interface AdminOperatorCredentialsRepo {
  insert(c: AdminOperatorCredential): Promise<AdminOperatorCredential>;
  byId(id: string): Promise<AdminOperatorCredential | null>;
  byKeyHash(hash: string): Promise<AdminOperatorCredential | null>;
  forOperator(operatorId: string): Promise<AdminOperatorCredential[]>;
  update(c: AdminOperatorCredential): Promise<AdminOperatorCredential>;
  touchLastUsed(id: string, ts: string): Promise<boolean>;
}

/** Repo group — satisfied by the package `adminOperators` stores AND
 *  by the memory impl. Structural (intel db-stores precedent): the
 *  installed package may not expose the field yet. */
export interface AdminOperatorRepos {
  operators: AdminOperatorsRepo;
  credentials: AdminOperatorCredentialsRepo;
}

// ---------- Domain store (single impl over repos — ops.ts) ----------

export type CreateOperatorResult =
  | { ok: true; operator: AdminOperator }
  | {
      ok: false;
      reason:
        | "invalid_id"
        | "invalid_principal_type"
        | "invalid_capability"
        | "invalid_display_name"
        | "duplicate_id"
        /** Arc-264-16 M4: "break_glass" is a valid enum member but
         *  reserved — ceremony artifacts only, never admin-created. */
        | "reserved_principal_type";
    };

export type IssueCredentialResult =
  | { ok: true; credential: AdminOperatorCredential }
  | {
      ok: false;
      reason:
        | "invalid_id"
        | "invalid_key_hash"
        | "invalid_key_prefix"
        | "missing_operator"
        | "disabled_operator"
        | "duplicate_id"
        | "duplicate_hash"
        /** 264-5: the hash equals sha256(ADMIN_API_KEY) — persisting
         *  it would let the shared key authenticate as a PERSONAL
         *  identity on the store-hit path, bypassing break-glass
         *  marking/alerting (264-9). */
        | "key_is_shared_secret";
    };

export type RevokeCredentialResult =
  | { ok: true; credential: AdminOperatorCredential }
  | {
      ok: false;
      /** `last_operator` (C5): the credential is the LAST active one
       *  on the LAST active human — revoking it locks out all human
       *  access. Use the break-glass CLI instead (D-264-Q15). */
      reason: "missing" | "last_operator";
    };

export type DisableOperatorResult =
  | { ok: true; operator: AdminOperator }
  | {
      ok: false;
      /** `last_operator` (C5): this is the LAST active human —
       *  disabling it locks out all human access. */
      reason: "missing" | "last_operator";
    };

export type EnableOperatorResult =
  | { ok: true; operator: AdminOperator }
  | { ok: false; reason: "missing" };

export interface OperatorStore {
  readonly backend: "postgres" | "memory";

  // ─── reads ──
  getOperator(id: string): Promise<AdminOperator | null>;
  listOperators(opts?: {
    status?: AdminOperator["status"];
    principalType?: AdminPrincipalType;
  }): Promise<AdminOperator[]>;
  listCredentialsForOperator(
    operatorId: string,
  ): Promise<AdminOperatorCredential[]>;
  /** Auth path — pair lookup; the caller judges both statuses. */
  getOperatorByKeyHash(
    keyHash: string,
  ): Promise<{
    operator: AdminOperator;
    credential: AdminOperatorCredential;
  } | null>;
  /** C5 guard seam (slice-3 consumes it). */
  activeHumanCount(): Promise<number>;

  // ─── writes ──
  createOperator(input: {
    id: string;
    displayName: string;
    principalType: string;
    capabilities: string[];
  }): Promise<CreateOperatorResult>;
  /** Caller supplies the HASH — plaintext never enters the store. */
  issueCredential(input: {
    id: string;
    operatorId: string;
    keyHash: string;
    keyPrefix: string;
  }): Promise<IssueCredentialResult>;
  /** Idempotent — re-revoking returns the row unchanged. C5-guarded:
   *  the last active credential of the last active human refuses. */
  revokeCredential(id: string): Promise<RevokeCredentialResult>;
  /** Idempotent — re-disabling returns the row unchanged. C5-guarded:
   *  the last active human refuses. */
  disableOperator(id: string): Promise<DisableOperatorResult>;
  /** Idempotent — re-enabling returns the row unchanged. */
  enableOperator(id: string): Promise<EnableOperatorResult>;
  /** Best-effort diagnostics touch (auth middleware throttles). */
  touchLastUsed(credentialId: string, ts: string): Promise<boolean>;
}
