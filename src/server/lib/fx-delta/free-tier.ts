/**
 * FX-delta free-tier rate limit (191-5) — 1 req/min per identity
 * (X-Wallet → IP); over-limit → 402 pointing at the premium x402 gate.
 * Extracted from routes/fx-delta-api.ts (file cap).
 */

import type { Context, Next } from "hono";
import { ErrorCodes } from "../error-codes";

const FREE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Test hook — clears free-tier buckets. */
export function resetFxDeltaFreeTier(): void {
  buckets.clear();
}

function identity(c: Context): string {
  return (
    c.req.header("x-wallet") ??
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous"
  );
}

/** Free-tier gate: 1 req/min per identity → 402 with premium link. */
export function freeTierGate(c: Context, next: Next) {
  const key = identity(c);
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + FREE_WINDOW_MS };
    buckets.set(key, b);
  }
  if (++b.count > 1) {
    return c.json(
      {
        code: ErrorCodes.PAYMENT_REQUIRED,
        error: "Free tier: 1 req/min. Upgrade for real-time access.",
        premium: "/api/fx-delta/premium/snapshot",
        pricing: {
          amount: "0.005",
          currency: "USDC",
          network: "eip155:42220",
        },
      },
      402,
    );
  }
  return next();
}
