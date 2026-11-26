/**
 * SLICE-255-4: MMF §5.6/§7 canonical serialization — pure functions,
 * byte-exact vs corpus vectors. Lives in tests/ (conformance lib,
 * not prod code — src/ untouched).
 *
 * §5.6 evidence record:
 *   len:EVENT|len:TX_ID|len:MANDATE_ID|len:AGENT|len:PAYEE|
 *   len:AMOUNT|len:CURRENCY|len:ALLOWED|len:CHECK|len:STATUS|
 *   len:REFERENCE|len:TIMESTAMP_MS|len:PREV_HASH
 *
 * Rules: len = UTF-8 byte length base-10; absent/null/empty → "0:";
 * AMOUNT out of [1, 2^53-1] integer → literal "invalid" (null too);
 * TIMESTAMP_MS = floor(sec×1000 + 0.5); prev_hash genesis = 64 zeros.
 *
 * §7 bounds payload:
 *   len:principal|len:ISSUED_AT|len:parent|len:max_amount|len:currency|
 *   len:payees(sorted,","-joined)|len:expires_in_days|len:velocity|
 *   len:total_budget|len:budget_window_days   (null parent/budget → 0:)
 * §7 signed payload:
 *   len:mandate_id|len:agent|len:bounds_hash|len:EXPIRES_AT
 * (timestamps in §7 = canonical number of the value — plain seconds)
 */
import { createHash } from "node:crypto";

const enc = new TextEncoder();

/** One canonical field: `<utf8-byte-len>:<value>`; empty → `0:`. */
export function field(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "0:";
  return `${enc.encode(v).length}:${v}`;
}

/** Canonical number (§5.6): integer → base-10; non-integer →
 *  shortest exact decimal (corpus uses integers + .25/.5 only). */
export function canonNumber(n: number): string {
  if (!Number.isFinite(n)) return "invalid";
  if (Number.isInteger(n)) return String(n);
  // exact minimal decimal — corpus only exercises ≤3 decimals
  return String(n);
}

const AMOUNT_MAX = Number.MAX_SAFE_INTEGER; // 2^53 − 1

/** AMOUNT field: integer in [1, 2^53−1] → digits; everything else
 *  (incl. null, fractions, out-of-range) → literal `invalid`. */
export function canonAmount(a: unknown): string {
  if (
    typeof a === "number" &&
    Number.isInteger(a) &&
    a >= 1 &&
    a <= AMOUNT_MAX
  ) {
    return String(a);
  }
  return "invalid";
}

export function sha256hex(s: string | Uint8Array): string {
  return createHash("sha256").update(s).digest("hex");
}

export const GENESIS = "0".repeat(64);

export interface CanonEvidenceRecord {
  event?: string;
  tx_id?: string;
  mandate_id?: string;
  agent?: string;
  payee?: string;
  amount?: number | null;
  currency?: string;
  allowed?: boolean;
  check?: string;
  status?: string;
  reference?: string;
  timestamp?: number;
  /** EPIC-263 §6: clamped DECISION carries the three extra fields. */
  clamped?: boolean;
  requested_amount?: number | null;
  effective_cap?: number | null;
  [k: string]: unknown;
}

/** §5.6 payload for one evidence record.
 *
 *  EPIC-263 §6 (draft v0.5-clamp, frozen pin a91b7f4): when
 *  `clamped === true`, three length-prefixed fields — `true`,
 *  `requested_amount`, `effective_cap` — insert immediately BEFORE
 *  `prev_hash`. Records with clamped absent/false serialize exactly
 *  as in v0.3.24 (every existing hash stays byte-identical). */
export function evidencePayload(
  r: CanonEvidenceRecord,
  prevHash: string,
): string {
  const tsMs =
    r.timestamp === undefined
      ? ""
      : String(Math.floor(r.timestamp * 1000 + 0.5));
  const base = [
    field(r.event),
    field(r.tx_id),
    field(r.mandate_id),
    field(r.agent),
    field(r.payee),
    field(canonAmount(r.amount)),
    field(r.currency),
    field(r.allowed === undefined ? undefined : String(r.allowed)),
    field(r.check),
    field(r.status),
    field(r.reference),
    field(tsMs),
  ];
  if (r.clamped === true) {
    base.push(
      field("true"),
      field(canonAmount(r.requested_amount)),
      field(canonAmount(r.effective_cap)),
    );
  }
  base.push(field(prevHash));
  return base.join("|");
}

/** Chain: recompute payloads + hashes, return head + per-record rows. */
export function evidenceChain(records: CanonEvidenceRecord[]): Array<{
  payload: string;
  hash: string;
}> {
  const out: Array<{ payload: string; hash: string }> = [];
  let prev = GENESIS;
  for (const r of records) {
    const payload = evidencePayload(r, prev);
    const hash = sha256hex(payload);
    out.push({ payload, hash });
    prev = hash;
  }
  return out;
}

export interface CanonMandateInputs {
  principal?: string;
  issued_at?: number;
  parent_mandate_id?: string;
  mandate_id?: string;
  agent?: string;
  expires_at?: number;
  bounds?: {
    max_amount?: number;
    currency?: string;
    allowed_payees?: string[];
    expires_in_days?: number;
    velocity_limit?: number;
    total_budget?: number;
    budget_window_days?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** §7 bounds payload — the bytes `bounds_hash` covers. */
export function boundsPayload(i: CanonMandateInputs): string {
  const b = i.bounds ?? {};
  const payees = [...(b.allowed_payees ?? [])].sort().join(",");
  return [
    field(i.principal),
    field(i.issued_at === undefined ? undefined : canonNumber(i.issued_at)),
    field(i.parent_mandate_id),
    field(b.max_amount === undefined ? undefined : canonNumber(b.max_amount)),
    field(b.currency),
    field(payees),
    field(
      b.expires_in_days === undefined
        ? undefined
        : canonNumber(b.expires_in_days),
    ),
    field(
      b.velocity_limit === undefined
        ? undefined
        : canonNumber(b.velocity_limit),
    ),
    field(
      b.total_budget === undefined
        ? undefined
        : canonNumber(b.total_budget),
    ),
    field(
      b.budget_window_days === undefined
        ? undefined
        : canonNumber(b.budget_window_days),
    ),
  ].join("|");
}

/** §7 signed payload — the bytes the Ed25519 signature covers. */
export function credentialPayload(
  i: CanonMandateInputs,
  boundsHash: string,
): string {
  return [
    field(i.mandate_id),
    field(i.agent),
    field(boundsHash),
    field(i.expires_at === undefined ? undefined : canonNumber(i.expires_at)),
  ].join("|");
}
