/**
 * EPIC-226 / SLICE-226-2 — shared contract guards for FinOps domain
 * services: non-empty operator, evidence ≤ 4 KB, decimal-string money
 * math (integer BigInt micro-units — floats never touch money).
 */

import {
  EVIDENCE_MAX_BYTES,
  type FinOpsResult,
  ok,
} from "./types";

/** `null` when the operator label is usable; error result otherwise. */
export function requireOperator(
  operator: string | undefined | null,
): FinOpsErrorResult | null {
  if (typeof operator !== "string" || operator.trim().length === 0) {
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

/** `9.99` → true; `abc` / `1.2.3` / `1e5` → false. */
export function isDecimalString(v: unknown): v is string {
  return typeof v === "string" && DECIMAL_RE.test(v);
}

/** Decimal string → signed micro-unit BigInt (6dp, frac padded/truncated). */
export function decimalToMicro(amount: string): bigint {
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
