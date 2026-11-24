// EPIC-264 (SLICE-264-3): operator lifecycle — the domain layer ABOVE
// the store. Plaintext is generated HERE and returned exactly once
// (C1/C11: credential lifecycle never rewrites operator identity);
// the store only ever sees sha256+prefix.
//
// D-264-Q16: isOperatorRef's rules moved to operator CREATION — the
// request-side guard (requireOperatorRef/x-operator-id) dies in
// 264-6. The name rules are ported verbatim: NFKC + trim + lowercase,
// [a-z0-9._@-]{1,80} allowlist, agent-shape denylist.
//
// Key shape note: the plaintext is "opk_"+32 base64url (192-bit) —
// same as intel's abop_ precedent; the "<id>" segment in D-264-Q2's
// opk_<id>_<rand> shorthand is the keyPrefix identification column,
// NOT a literal id inside the secret.

import { generateReportId } from "../../../agent-readiness/integrity/ulid";

import {
  adminKeyPrefix,
  generateAdminKeyPlaintext,
  hashAdminKey,
  isAdminKeyPlaintext,
} from "./operator-key";
import type {
  AdminOperator,
  AdminOperatorCredential,
  AdminPrincipalType,
} from "./types";
import { ADMIN_CAPABILITIES } from "./types";
import type {
  CreateOperatorResult,
  IssueCredentialResult,
  OperatorStore,
} from "./store";

// ---------- name validation (D-264-Q16 — was isOperatorRef) ----------

const OPERATOR_NAME_RE = /^[a-z0-9._@-]{1,80}$/;
const AGENT_NAME_DENY = /^(did|agent|bot|svc|key|agt)([0-9]|[-_.@:]|$)/;

/** Canonical form: NFKC + trim + lowercase — "Alice" and fullwidth
 *  "ａｌｉｃｅ" are the same operator name. */
export const normalizeOperatorName = (name: string): string =>
  name.normalize("NFKC").trim().toLowerCase();

export function isOperatorName(name: string): boolean {
  const s = normalizeOperatorName(name);
  return OPERATOR_NAME_RE.test(s) && !AGENT_NAME_DENY.test(s);
}

// ---------- results ----------

export type LifecycleCreateResult =
  | CreateOperatorResult
  | { ok: false; reason: "invalid_display_name" | "duplicate_display_name" };

export type IssueKeyResult =
  | { ok: true; key: string; credential: AdminOperatorCredential }
  | Extract<IssueCredentialResult, { ok: false }>;

export type RotateCredentialResult =
  | {
      ok: true;
      key: string;
      credential: AdminOperatorCredential;
      revoked: AdminOperatorCredential;
    }
  | {
      ok: false;
      reason:
        | "missing_operator"
        | "missing_credential"
        | "already_revoked";
    }
  | {
      ok: false;
      reason: "issue_failed" | "revoke_failed";
      detail: string;
      /** the new key was already materialized — carried so it isn't
       *  lost; the caller surfaces it and retries/cleans up */
      key?: string;
      credential?: AdminOperatorCredential;
    };

// ---------- ops ----------

/** Validated operator creation — the displayName IS the operator ref:
 *  canonicalized and bound to the credential forever (audit shows it,
 *  not a self-asserted header). */
export async function createOperator(
  store: OperatorStore,
  input: {
    id?: string;
    displayName: string;
    principalType: AdminPrincipalType;
    capabilities: readonly string[];
  },
): Promise<LifecycleCreateResult> {
  const displayName = normalizeOperatorName(input.displayName);
  if (!OPERATOR_NAME_RE.test(displayName) || AGENT_NAME_DENY.test(displayName)) {
    return { ok: false, reason: "invalid_display_name" };
  }
  const taken = (await store.listOperators()).some(
    (o) => normalizeOperatorName(o.displayName) === displayName,
  );
  if (taken) return { ok: false, reason: "duplicate_display_name" };
  return store.createOperator({
    id: input.id ?? `op_${generateReportId()}`,
    displayName,
    principalType: input.principalType,
    capabilities: [...input.capabilities],
  });
}

/** Issue a fresh credential — plaintext returned ONCE, never stored. */
export async function issueOperatorCredential(
  store: OperatorStore,
  operatorId: string,
): Promise<IssueKeyResult> {
  const plaintext = generateAdminKeyPlaintext();
  const res = await store.issueCredential({
    id: `opc_${generateReportId()}`,
    operatorId,
    keyHash: hashAdminKey(plaintext),
    keyPrefix: adminKeyPrefix(plaintext),
  });
  if (!res.ok) return res;
  return { ok: true, key: plaintext, credential: res.credential };
}

/** Atomic-ish rotation: issue the new credential BEFORE revoking the
 *  old — the C5 last-operator guard always sees a surviving active
 *  credential, and a revoke failure leaves a clean two-key state the
 *  caller can inspect (the new key is carried in the failure result). */
export async function rotateOperatorCredential(
  store: OperatorStore,
  operatorId: string,
  credentialId: string,
): Promise<RotateCredentialResult> {
  if (!(await store.getOperator(operatorId))) {
    return { ok: false, reason: "missing_operator" };
  }
  const creds = await store.listCredentialsForOperator(operatorId);
  const target = creds.find((c) => c.id === credentialId);
  if (!target) return { ok: false, reason: "missing_credential" };
  if (target.status !== "active") {
    return { ok: false, reason: "already_revoked" };
  }
  const issued = await issueOperatorCredential(store, operatorId);
  if (!issued.ok) {
    return { ok: false, reason: "issue_failed", detail: issued.reason };
  }
  const revoked = await store.revokeCredential(credentialId);
  if (!revoked.ok) {
    return {
      ok: false,
      reason: "revoke_failed",
      detail: revoked.reason,
      key: issued.key,
      credential: issued.credential,
    };
  }
  return {
    ok: true,
    key: issued.key,
    credential: issued.credential,
    revoked: revoked.credential,
  };
}

// ---------- one-shot env seed (D-264-Q15, C9) ----------

export interface OperatorSeed {
  id?: string;
  displayName: string;
  /** REQUIRED — the bootstrap plaintext; "opk_"+32 base64url. */
  key: string;
}

export type OperatorSeedResult =
  | { ok: true; seeded: true; operatorId: string; credentialId: string }
  | { ok: true; seeded: false; reason: "not_empty" | "not_configured" }
  | { ok: false; reason: string };

/**
 * C9 one-shot bootstrap: applies ONLY while the operators table is
 * empty. A rerun is a strict no-op — it never resurrects a revoked
 * credential, never re-enables a disabled operator, never overwrites.
 * The seeded human gets the FULL capability set — it exists to hand
 * out operator-admin access, anything less bootstraps nothing.
 */
export async function applyOperatorSeed(
  store: OperatorStore,
  seed: OperatorSeed,
): Promise<OperatorSeedResult> {
  if ((await store.listOperators()).length > 0) {
    return { ok: true, seeded: false, reason: "not_empty" };
  }
  if (!isAdminKeyPlaintext(seed.key)) {
    return {
      ok: false,
      reason: "seed key must be opk_<32 base64url> (generate via operator:create --key-only or node crypto)",
    };
  }
  const op = await createOperator(store, {
    id: seed.id,
    displayName: seed.displayName,
    principalType: "human",
    capabilities: ADMIN_CAPABILITIES,
  });
  if (!op.ok) return { ok: false, reason: `operator: ${op.reason}` };
  const cred = await store.issueCredential({
    id: `opc_${generateReportId()}`,
    operatorId: op.operator.id,
    keyHash: hashAdminKey(seed.key),
    keyPrefix: adminKeyPrefix(seed.key),
  });
  if (!cred.ok) return { ok: false, reason: `credential: ${cred.reason}` };
  return {
    ok: true,
    seeded: true,
    operatorId: op.operator.id,
    credentialId: cred.credential.id,
  };
}

/** OPERATOR_SEED_JSON={"id"?,"displayName","key"} — parsed + applied
 *  at boot; absent env is a quiet no-op, malformed JSON is a loud one. */
export async function seedOperatorsFromEnv(
  store: OperatorStore,
  raw: string | undefined = process.env.OPERATOR_SEED_JSON,
): Promise<OperatorSeedResult> {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, seeded: false, reason: "not_configured" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "OPERATOR_SEED_JSON is not valid JSON" };
  }
  const p = parsed as Record<string, unknown>;
  if (
    typeof p !== "object" ||
    p === null ||
    typeof p.displayName !== "string" ||
    typeof p.key !== "string" ||
    (p.id !== undefined && typeof p.id !== "string")
  ) {
    return {
      ok: false,
      reason: "OPERATOR_SEED_JSON must be {id?, displayName, key}",
    };
  }
  return applyOperatorSeed(store, {
    id: p.id as string | undefined,
    displayName: p.displayName,
    key: p.key,
  });
}

// re-export for lifecycle callers (CLI, routes) — single import point
export { ADMIN_CAPABILITIES, generateAdminKeyPlaintext, isAdminKeyPlaintext };
export type { AdminOperator };
