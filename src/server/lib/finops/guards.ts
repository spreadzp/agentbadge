/**
 * EPIC-226 / SLICE-226-2 — shared contract guards for FinOps domain
 * services: non-empty operator, evidence ≤ 4 KB, decimal-string money
 * math (integer BigInt micro-units — floats never touch money).
 */

import {
  EVIDENCE_MAX_BYTES,
  type FinOpsResult,
  fail,
  ok,
} from "./types";

/** Operator label cap — H5/226-6: normalized labels stay bounded. */
export const OPERATOR_MAX_LEN = 64;
/** Generic free-text cap — applied BEFORE any effect (C1). */
export const MAX_TEXT_FIELD = 512;
/** subjectRef / ids / references. */
export const MAX_ID_FIELD = 128;
/** EVM wallet address length incl. 0x (42) — headroom for checksummed. */
export const MAX_PAYEE_LEN = 42;
export const MAX_CURRENCY_LEN = 16;
/** Decimal-string length cap — unbounded digit strings stall BigInt (M7). */
export const MAX_AMOUNT_LEN = 40;

/**
 * H5/226-6: canonical operator label — NFKC, format/control chars
 * stripped (zero-width, bidi, hangul filler), whitespace collapsed,
 * capped at 64 code points. Stored and filtered in this form.
 */
export function normalizeOperator(v: string): string {
  const cleaned = v
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Cc}\p{Cs}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...cleaned].slice(0, OPERATOR_MAX_LEN).join("");
}

/** `null` when the operator label is usable; error result otherwise. */
export function requireOperator(
  operator: string | undefined | null,
): FinOpsErrorResult | null {
  if (
    typeof operator !== "string" ||
    normalizeOperator(operator).length === 0
  ) {
    return {
      ok: false,
      error: {
        code: "OPERATOR_REQUIRED",
        message: "operator label is required for every manual action",
      },
    };
  }
  return null;
}

/** `null` when `v` fits the field cap — run BEFORE any effect (C1). */
export function checkTextField(
  v: string,
  name: string,
  max: number,
): FinOpsResult<never> | null {
  if (v.length > max) {
    return fail("BAD_INPUT", `${name} exceeds ${max} characters`);
  }
  return null;
}

/**
 * H1/226-6: evidence must carry content — non-blank string, non-empty
 * array, or an object with keys. Bare scalars/empties are not evidence.
 */
export function isMeaningfulEvidence(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
}

/** `0x` + 40 hex — EVM payout destination. */
export function isEvmAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

const TX_HASH_RE = /^0x[0-9a-f]{64}$/;
/**
 * C3/226-6: canonical lowercase `0x`+64-hex form, or null — replay
 * checks and the unique index only work on normalized hashes.
 */
export function normalizeTxHash(v: string): string | null {
  const h = v.trim().toLowerCase();
  return TX_HASH_RE.test(h) ? h : null;
}

interface FinOpsErrorResult {
  ok: false;
  error: { code: "OPERATOR_REQUIRED" | "EVIDENCE_TOO_LARGE"; message: string };
}

/** `null` when evidence fits the ≤4KB contract cap (JSON.stringify). */
export function checkEvidence(evidence: unknown): FinOpsErrorResult | null {
  if (evidence === undefined || evidence === null) return null;
  let size: number;
  try {
    size = JSON.stringify(evidence).length;
  } catch {
    return {
      ok: false,
      error: {
        code: "EVIDENCE_TOO_LARGE",
        message: "evidence is not JSON-serializable",
      },
    };
  }
  if (size > EVIDENCE_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: "EVIDENCE_TOO_LARGE",
        message: `evidence exceeds ${EVIDENCE_MAX_BYTES} bytes (${size})`,
      },
    };
  }
  return null;
}

/** Run both guards; returns a FinOps error result or null. */
export function guardAction(
  operator: string | undefined | null,
  evidence: unknown,
): FinOpsResult<never> | null {
  const op = requireOperator(operator);
  if (op) return op as FinOpsResult<never>;
  const ev = checkEvidence(evidence);
  if (ev) return ev as FinOpsResult<never>;
  return null;
}

// ---------- decimal-string money (6dp micro-unit BigInt math) ----------

const MICRO = 1_000_000n;
const DECIMAL_RE = /^-?\d+(\.\d{1,12})?$/;

/** `9.99` → true; `abc` / `1.2.3` / `1e5` / 10⁹-digit strings → false. */
export function isDecimalString(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= MAX_AMOUNT_LEN &&
    DECIMAL_RE.test(v)
  );
}

/** Decimal string → signed micro-unit BigInt (6dp, frac padded/truncated).
 *  Throws on non-decimal input — `BigInt("0x10")` silently parses hex
 *  (M3); callers validating via isDecimalString are unaffected. */
export function decimalToMicro(amount: string): bigint {
  if (!isDecimalString(amount)) {
    throw new Error(`not a decimal string: ${JSON.stringify(amount)}`);
  }
  const neg = amount.startsWith("-");
  const s = neg ? amount.slice(1) : amount;
  const dot = s.indexOf(".");
  const int = dot === -1 ? s : s.slice(0, dot);
  const frac = (dot === -1 ? "" : s.slice(dot + 1))
    .padEnd(6, "0")
    .slice(0, 6);
  const v = BigInt(int || "0") * MICRO + BigInt(frac || "0");
  return neg ? -v : v;
}

/**
 * Micro-unit BigInt → decimal string, trailing zeros trimmed but a
 * minimum of 2dp kept — money canonical form (`"9.99"`, `"1.025"`).
 */
export function microToDecimal(micro: bigint): string {
  const neg = micro < 0n;
  const v = neg ? -micro : micro;
  const int = v / MICRO;
  let frac = String(v % MICRO).padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  const s = `${int}.${frac}`;
  return neg ? `-${s}` : s;
}

/** Σ decimal strings → decimal string. Malformed entries are skipped. */
export function sumDecimals(amounts: readonly string[]): string {
  let acc = 0n;
  for (const a of amounts) {
    if (!isDecimalString(a)) continue;
    acc += decimalToMicro(a);
  }
  return microToDecimal(acc);
}

/** a > b on decimal strings (null amount → treated as not-greater). */
export function decimalGt(a: string | null | undefined, b: string): boolean {
  if (!a || !isDecimalString(a) || !isDecimalString(b)) return false;
  return decimalToMicro(a) > decimalToMicro(b);
}

/** a <= b on decimal strings. */
export function decimalLte(
  a: string | null | undefined,
  b: string,
): boolean {
  if (!a || !isDecimalString(a) || !isDecimalString(b)) return false;
  return decimalToMicro(a) <= decimalToMicro(b);
}

/** `amount` × (bps/10_000) + `fixed` — fee estimation, decimal in/out. */
export function feeOf(
  amount: string,
  bps: number,
  fixed: string = "0",
): string {
  const micro = decimalToMicro(amount);
  const fee = (micro * BigInt(Math.trunc(bps))) / 10_000n;
  return microToDecimal(fee + decimalToMicro(fixed));
}

/** a − b on decimal strings. */
export function decimalSub(a: string, b: string): string {
  return microToDecimal(decimalToMicro(a) - decimalToMicro(b));
}

export { ok };
