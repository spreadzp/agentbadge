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
