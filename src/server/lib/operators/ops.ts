// EPIC-264 (SLICE-264-1): domain ops over the repo group — ONE
// implementation shared by the memory and Postgres backends (intel
// operators.ts precedent). Validation invariants live here so both
// backends reject identically.

import {
  ADMIN_CAPABILITIES,
  ADMIN_PRINCIPAL_TYPES,
  type AdminOperator,
} from "./types";
import { isAdminKeyPlaintext } from "./operator-key";
import type { AdminOperatorRepos, OperatorStore } from "./store";

// house id shape: <prefix>_<26-char Crockford ULID> (generateReportId)
const OPERATOR_ID_RE = /^op_[0-9A-HJKMNP-TV-Z]{26}$/;
const CREDENTIAL_ID_RE = /^opc_[0-9A-HJKMNP-TV-Z]{26}$/;
// keyHash is sha256-hex ONLY — the store layer enforces it so a
// plaintext (or anything else) can never be persisted as a hash.
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
// "opk_"+8 base64url secret chars — identification column only.
const KEY_PREFIX_RE = /^opk_[A-Za-z0-9_-]{8}$/;
// displayName lands in audit output — bounded and non-empty.
const DISPLAY_NAME_MAX = 200;

// PG unique-violation (23505) or the memory impl's mirror throw —
// distinguish PK (duplicate_id) from @@unique(keyHash).
function uniqueReason(
  err: unknown,
): "duplicate_id" | "duplicate_hash" | null {
  const msg =
    err instanceof Error
      ? `${err.message} ${(err as { code?: string }).code ?? ""}`
      : String(err);
  if (!/23505|unique|duplicate/i.test(msg)) return null;
  return /keyhash/i.test(msg) ? "duplicate_hash" : "duplicate_id";
}

export function createOperatorStore(
  repos: AdminOperatorRepos,
  backend: OperatorStore["backend"],
): OperatorStore {
  const now = () => new Date().toISOString();

  return {
    backend,

    getOperator: (id) => repos.operators.byId(id),
    listOperators: (opts) => repos.operators.list(opts),
    listCredentialsForOperator: (operatorId) =>
      repos.credentials.forOperator(operatorId),
    activeHumanCount: () => repos.operators.countActiveHumans(),

    async getOperatorByKeyHash(keyHash) {
      const credential = await repos.credentials.byKeyHash(keyHash);
      if (!credential) return null;
      const operator = await repos.operators.byId(credential.operatorId);
      if (!operator) return null;
      return { operator, credential };
    },

    async createOperator(input) {
      if (!OPERATOR_ID_RE.test(input.id)) {
        return { ok: false, reason: "invalid_id" };
      }
      if (
        !ADMIN_PRINCIPAL_TYPES.includes(
          input.principalType as AdminOperator["principalType"],
        )
      ) {
        return { ok: false, reason: "invalid_principal_type" };
      }
      if (
        input.capabilities.some(
          (c) =>
            !(ADMIN_CAPABILITIES as readonly string[]).includes(c),
        )
      ) {
        return { ok: false, reason: "invalid_capability" };
      }
      const displayName = input.displayName.trim();
      if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX) {
        return { ok: false, reason: "invalid_display_name" };
      }
      if (await repos.operators.byId(input.id)) {
        return { ok: false, reason: "duplicate_id" };
      }
      try {
        const operator = await repos.operators.insert({
          id: input.id,
          displayName,
          principalType:
            input.principalType as AdminOperator["principalType"],
          capabilities: [...input.capabilities],
          status: "active",
          createdAt: now(),
          disabledAt: null,
        });
        return { ok: true, operator };
      } catch (err) {
        const reason = uniqueReason(err);
        if (reason === "duplicate_id") {
          return { ok: false, reason };
        }
        throw err;
      }
    },

    async issueCredential(input) {
      if (!CREDENTIAL_ID_RE.test(input.id)) {
        return { ok: false, reason: "invalid_id" };
      }
      // DoD #4: hash-only persistence — a non-sha256 value (incl. an
      // opk_ plaintext) must never reach the credential row.
      if (
        !SHA256_HEX_RE.test(input.keyHash) ||
        isAdminKeyPlaintext(input.keyHash)
      ) {
        return { ok: false, reason: "invalid_key_hash" };
      }
      if (!KEY_PREFIX_RE.test(input.keyPrefix)) {
        return { ok: false, reason: "invalid_key_prefix" };
      }
      const operator = await repos.operators.byId(input.operatorId);
      if (!operator) return { ok: false, reason: "missing_operator" };
      if (operator.status !== "active") {
        return { ok: false, reason: "disabled_operator" };
      }
      if (await repos.credentials.byId(input.id)) {
        return { ok: false, reason: "duplicate_id" };
      }
      if (await repos.credentials.byKeyHash(input.keyHash)) {
        return { ok: false, reason: "duplicate_hash" };
      }
      try {
        const credential = await repos.credentials.insert({
          id: input.id,
          operatorId: input.operatorId,
          keyHash: input.keyHash,
          keyPrefix: input.keyPrefix,
          status: "active",
          issuedAt: now(),
          revokedAt: null,
          lastUsedAt: null,
        });
        return { ok: true, credential };
      } catch (err) {
        const reason = uniqueReason(err);
        if (reason) return { ok: false, reason };
        throw err;
      }
    },

    async revokeCredential(id) {
      const credential = await repos.credentials.byId(id);
      if (!credential) return { ok: false, reason: "missing" };
      if (credential.status === "revoked") {
        return { ok: true, credential }; // idempotent
      }
      return {
        ok: true,
        credential: await repos.credentials.update({
          ...credential,
          status: "revoked",
          revokedAt: now(),
        }),
      };
    },

    async disableOperator(id) {
      const operator = await repos.operators.byId(id);
      if (!operator) return { ok: false, reason: "missing" };
      if (operator.status === "disabled") {
        return { ok: true, operator }; // idempotent
      }
      return {
        ok: true,
        operator: await repos.operators.update({
          ...operator,
          status: "disabled",
          disabledAt: now(),
        }),
      };
    },

    touchLastUsed: (credentialId, ts) =>
      repos.credentials.touchLastUsed(credentialId, ts),
  };
}
