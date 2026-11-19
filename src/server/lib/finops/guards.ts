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
 * H5/226-6 + N6: canonical operator label — controls collapse to
 * spaces, default-ignorable + blank-lookalike code points (zero-width,
 * bidi, hangul/braille fillers) are stripped, whitespace collapsed,
 * capped at 64 code points. Idempotent: normalize(normalize(x)) ===
 * normalize(x), so callers and the audit filter agree on stored form.
 */
const IGNORABLE_OR_BLANK =
  /[\p{Cf}\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0\u2800]/gu;

export function normalizeOperator(v: string): string {
  const strip = (s: string): string =>
    s
      .replace(/[\p{Cc}\p{Cs}]/gu, " ")
      .replace(IGNORABLE_OR_BLANK, "");
  const cleaned = strip(strip(v).normalize("NFKC"))
    .replace(/\s+/g, " ")
    .trim();
  return [...cleaned].slice(0, OPERATOR_MAX_LEN).join("").trimEnd();
}

/** `null` when the operator label is usable; error result otherwise.
 *  L-9: the normalized label must contain at least one letter or
 *  digit — a label built only from combining marks/private-use code
 *  points is non-empty but renders blank in the audit console. */
export function requireOperator(
  operator: string | undefined | null,
): FinOpsErrorResult | null {
  const normalized =
    typeof operator === "string" ? normalizeOperator(operator) : "";
  if (normalized.length === 0 || !/[\p{L}\p{N}]/u.test(normalized)) {
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
 * M-2/round-3: cap a field by its JSON-SERIALIZED length, not raw
 * characters. `JSON.stringify` amplifies control/format/lone-
 * surrogate code points up to 6x ("\u00XX"), so a raw-length cap can
 * still overflow the 4 KB audit row the field lands in.
 */
export function checkSerialized(
  v: string,
  name: string,
  maxBytes: number,
): FinOpsResult<never> | null {
  if (JSON.stringify(v).length > maxBytes) {
    return fail(
      "BAD_INPUT",
      `${name} exceeds ${maxBytes} serialized bytes`,
    );
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

/** `0x` + 40 hex — EVM payout destination (zero address is not one). */
export function isEvmAddress(v: string): boolean {
  return (
    /^0x[0-9a-fA-F]{40}$/.test(v) &&
    v.toLowerCase() !== "0x0000000000000000000000000000000000000000"
  );
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

/**
 * N1/226-6 round 2: bound a value's serialized size for audit
 * evidence. Caller evidence passes `checkEvidence` at ≤4 KB on its
 * own, but WRAPPED into a larger audit object it can push the row
 * over the store cap — write a `{truncated,size}` marker instead.
 */
export function boundedEvidence(
  v: unknown,
  budget: number,
): unknown {
  if (v === undefined || v === null) return null;
  let size: number;
  try {
    size = JSON.stringify(v).length;
  } catch {
    return { truncated: true, unserializable: true };
  }
  if (size <= budget) return v;
  return { truncated: true, sizeBytes: size, budget };
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
// N16: 6dp max — all arithmetic truncates to micros, so accepting
// 12dp would let "100.0000009" pass a `<= 100` check.
const DECIMAL_RE = /^-?\d+(\.\d{1,6})?$/;

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

/**
 * Σ decimal strings → decimal string. M-8/round-3: malformed entries
 * THROW — money sums (refund caps, revenue) must never silently skip
 * a non-canonical amount and undercount.
 */
export function sumDecimals(amounts: readonly string[]): string {
  let acc = 0n;
  for (const a of amounts) {
    if (!isDecimalString(a)) {
      throw new Error(`malformed decimal in sum: ${JSON.stringify(a)}`);
    }
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
