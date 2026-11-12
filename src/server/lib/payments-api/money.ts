/**
 * Decimal-string money helpers (D-220 money rule): integer-cents
 * BigInt math only — floats never touch payment amounts.
 */

import { isUsdDecimal } from "@agentbadge/payments";

import { CheckoutError } from "./errors";

function usdToCentsBigInt(amount: string): bigint {
  const dot = amount.indexOf(".");
  const int = dot === -1 ? amount : amount.slice(0, dot);
  const frac = (dot === -1 ? "" : amount.slice(dot + 1)).padEnd(2, "0");
  return BigInt(int) * 100n + BigInt(frac);
}

/** "25" × 3 → "75.00"; "9.99" × 2 → "19.98". Throws on malformed USD. */
export function multiplyUsdDecimal(amount: string, quantity: number): string {
  if (!isUsdDecimal(amount)) {
    throw new CheckoutError(
      "invalid_quantity",
      400,
      `catalog price is not a USD decimal: ${amount}`,
    );
  }
  const cents = usdToCentsBigInt(amount) * BigInt(quantity);
  const int = cents / 100n;
  const frac = String(cents % 100n).padStart(2, "0");
  return `${int}.${frac}`;
}

/** "9.99" → 999 — integer cents for Stripe `amount_total` compares.
 *  Callers must pass a validated USD decimal (catalog/attempt amounts). */
export function usdToCentsInt(amount: string): number {
  return Number(usdToCentsBigInt(amount));
}

/**
 * USDC unique-amount suffix (SLICE-221-7, audit H-9): a deterministic
 * 1-999 micro-USDC suffix derived from the payment id so on-chain
 * transfers are distinguishable per payment — the verifier binds
 * evidence.amount to the attempt's unique amount, not just to the
 * catalog price shared by every concurrent buyer.
 * "9.99" → "9.990412" (6-decimal USDC precision; deterministic per seed).
 */
export function addUsdcMicroSuffix(amount: string, seed: string): string {
  if (!isUsdDecimal(amount)) {
    throw new CheckoutError(
      "invalid_quantity",
      400,
      `amount is not a USD decimal: ${amount}`,
    );
  }
  let hash = 0;
  for (const ch of seed) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  const suffix = BigInt((hash % 999) + 1); // 1..999 micro-USDC
  const micro = usdToCentsBigInt(amount) * 10_000n + suffix;
  const int = micro / 1_000_000n;
  const frac = String(micro % 1_000_000n).padStart(6, "0");
  return `${int}.${frac}`;
}
