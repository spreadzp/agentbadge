/**
 * SLICE-224-2 (EPIC-224): contract guards for commerce writes — limits
 * come from CONTRACT_LIMITS (206-1 single source, shared with
 * contract-guards.ts zod fragments):
 *   idempotencyKey 8-128 charset-restricted · summary ≤4000 ·
 *   evidenceRefs ≤50 × ≤1000.
 * Plus domain shape guards: lowercase EVM wallet (D-224-3), decimal
 * money strings, per-type evidence requirements (D-224-11).
 */
import { CONTRACT_LIMITS } from "../machine-entry";
import { guardRejected, type EvidenceType } from "./types";

/** `ct_/of_/ag_/sub_/ev_/pm_/evt_` + 24 hex chars of uuid. */
export function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error("crypto.randomUUID unavailable — refusing to mint ids");
  }
  return `${prefix}_${uuid.replace(/-/g, "").slice(0, 24)}`;
}

const WALLET_RE = /^0x[0-9a-f]{40}$/;

/** Canonical actor id: lowercase EVM wallet. Returns normalized value. */
export function assertWallet(wallet: unknown, field = "wallet"): string {
  if (typeof wallet !== "string") {
    throw guardRejected(`${field} must be an EVM wallet string`);
  }
  const w = wallet.toLowerCase();
  if (!WALLET_RE.test(w)) {
    throw guardRejected(`${field} must be a 0x-prefixed EVM address`, {
      field,
    });
  }
  return w;
}

export function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw guardRejected(`${field} must be a non-empty string`, { field });
  }
  return value;
}

/** summary / proposal / description — shared 4000-char cap. */
export function assertSummary(value: unknown, field = "summary"): string {
  const s = assertNonEmpty(value, field);
  if (s.length > CONTRACT_LIMITS.summary.maxLen) {
    throw guardRejected(
      `${field} exceeds ${CONTRACT_LIMITS.summary.maxLen} chars`,
      { field, max: CONTRACT_LIMITS.summary.maxLen },
    );
  }
  return s;
}

/** evidence_refs — ≤50 items × ≤1000 chars each. */
export function assertEvidenceRefs(
  refs: unknown,
  field = "evidenceRefs",
): string[] {
  if (refs === undefined || refs === null) return [];
  if (!Array.isArray(refs)) {
    throw guardRejected(`${field} must be an array of strings`, { field });
  }
  if (refs.length > CONTRACT_LIMITS.evidenceRefs.maxCount) {
    throw guardRejected(
      `${field} exceeds ${CONTRACT_LIMITS.evidenceRefs.maxCount} items`,
      { field, max: CONTRACT_LIMITS.evidenceRefs.maxCount },
    );
  }
  for (const r of refs) {
    if (typeof r !== "string" || r.length === 0) {
      throw guardRejected(`${field} items must be non-empty strings`, {
        field,
      });
    }
    if (r.length > CONTRACT_LIMITS.evidenceRefs.maxLen) {
      throw guardRejected(
        `${field} item exceeds ${CONTRACT_LIMITS.evidenceRefs.maxLen} chars`,
        { field, max: CONTRACT_LIMITS.evidenceRefs.maxLen },
      );
    }
  }
  return refs as string[];
}

const IDEM_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Idempotency-Key for create-writes: 8-128 chars, charset-restricted
 * (same rules as machine-entry schema — arbitrary values can't silently
 * collide).
 */
export function assertIdempotencyKey(key: unknown): string {
  if (typeof key !== "string") {
    throw guardRejected("idempotency key must be a string");
  }
  const { min, max } = CONTRACT_LIMITS.idempotencyKey;
  if (key.length < min || key.length > max || !IDEM_RE.test(key)) {
    throw guardRejected(
      `idempotency key must be ${min}-${max} chars, alphanumeric/'-'/'_'`,
      { min, max },
    );
  }
  return key;
}

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Money at the edge is a decimal string — never a float. */
export function assertDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !DECIMAL_RE.test(value)) {
    throw guardRejected(`${field} must be a decimal string`, { field });
  }
  return value;
}

const SHA256_RE = /^[0-9a-f]{64}$/i;
const TXHASH_RE = /^0x[0-9a-f]{64}$/i;

/**
 * Per-type evidence requirements (D-224-11):
 *   FILE → url + sha256 · HASH → sha256 · TRANSACTION → 0x txHash ·
 *   URL → url · API_RESPONSE → content · ATTESTATION → url|content.
 */
export function assertEvidenceShape(input: {
  type: EvidenceType;
  url?: string | null;
  hash?: string | null;
  content?: string | null;
}): void {
  const need = (cond: boolean, msg: string) => {
    if (!cond) throw guardRejected(msg, { type: input.type });
  };
  switch (input.type) {
    case "FILE":
      need(Boolean(input.url), "FILE evidence requires url");
      need(
        Boolean(input.hash && SHA256_RE.test(input.hash)),
        "FILE evidence requires sha256 hash",
      );
      break;
    case "HASH":
      need(
        Boolean(input.hash && SHA256_RE.test(input.hash)),
        "HASH evidence requires sha256 hash",
      );
      break;
    case "TRANSACTION":
      need(
        Boolean(input.hash && TXHASH_RE.test(input.hash)),
        "TRANSACTION evidence requires 0x txHash",
      );
      break;
    case "URL":
      need(Boolean(input.url), "URL evidence requires url");
      break;
    case "API_RESPONSE":
      need(Boolean(input.content), "API_RESPONSE evidence requires content");
      break;
    case "ATTESTATION":
      need(
        Boolean(input.url || input.content),
        "ATTESTATION evidence requires url or content",
      );
      break;
  }
}
