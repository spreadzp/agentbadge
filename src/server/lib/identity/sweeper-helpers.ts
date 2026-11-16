/**
 * SLICE-225-6 (EPIC-225): sweeper helpers — extracted from
 * sweeper.ts to keep it under the max-lines lint bound. Pure
 * functions/constants shared by the activation and reversal
 * passes.
 */
import type { PaymentRow } from "@agentbadge/database";

export const WALLET_RE = /^0x[0-9a-f]{40}$/;

/** Explicit reversal statuses (audit v2 N-5) — ONLY these revoke a
 *  grant. PENDING/PROCESSING/unknown statuses and missing payment
 *  rows RETAIN the entitlement (ambiguous ≠ reversed). */
export const REVERSAL_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "EXPIRED",
  "REVERSED",
  "REFUNDED",
  "CANCELLED",
  "CHARGEBACK",
]);

export function defaultOwnerFor(payment: PaymentRow): string | null {
  const c = payment.customerId;
  if (typeof c === "string" && WALLET_RE.test(c.toLowerCase())) {
    return c.toLowerCase();
  }
  return null;
}

/** Decimal-string parts ("9.99" → int 9, frac 99/2 digits). */
function parseDecimal(
  s: string,
): { int: bigint; frac: bigint; fracLen: number } | null {
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(s);
  if (!m) return null;
  return {
    int: BigInt(m[1]),
    frac: BigInt(m[2] ?? "0"),
    fracLen: (m[2] ?? "").length,
  };
}

/** Decimal-string compare without floats: amount ≥ min. */
export function amountAtLeast(amount: string, min: string): boolean {
  const a = parseDecimal(amount);
  const b = parseDecimal(min);
  if (!a || !b) return false;
  if (a.int !== b.int) return a.int > b.int;
  const scale = BigInt(Math.max(a.fracLen, b.fracLen));
  const af = a.frac * 10n ** (scale - BigInt(a.fracLen));
  const bf = b.frac * 10n ** (scale - BigInt(b.fracLen));
  return af >= bf;
}
