/**
 * bStock freemium gate (EPIC-141, SLICE-141-7).
 *
 * Free tier: 1 req/min per agent token → over the limit returns
 * HTTP 402 with a PAYMENT-REQUIRED header (base64 x402 requirements),
 * so standard x402 clients can pay automatically.
 *
 * Paid tier: X-Wallet holding a live ServicePass (hasAccess on Arc)
 * bypasses the free bucket — real-time access.
 *
 * Payment: PAYMENT-SIGNATURE (EIP-3009) → facilitator verify → settle
 * → mintServicePass (mints or extends, 30d) → request proceeds.
 *
 * Patterns: x402-base.ts (402 + facilitator verify/settle),
 * marketplace hooks.ts (mintServicePass on settle),
 * agent-auth.ts (injectable hasAccess for tests).
 */

import type { Context, MiddlewareHandler } from "hono";

export interface BstockPaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxAmountRequired: string;
  maxTimeoutSeconds?: number;
  resource: string;
  description: string;
  mimeType: string;
  extra?: Record<string, unknown>;
}

export interface BstockFacilitator {
  verify(
    paymentHeader: string,
    requirements: BstockPaymentRequirements,
  ): Promise<{ valid: boolean; error?: string }>;
  settle(
    paymentHeader: string,
    requirements: BstockPaymentRequirements,
  ): Promise<{
    success: boolean;
    transaction?: string;
    payer?: string;
    error?: string;
  }>;
}

export interface BstockFreemiumConfig {
  /** bytes32 service id in the marketplace catalog. */
  serviceId: `0x${string}`;
  /** USDC price, decimal string ("5"). */
  priceUsd: string;
  /** Pass lifetime in seconds (30d = 2592000). */
  durationSec: number;
  /** Treasury address receiving payments. */
  payTo: string;
  /** CAIP-2 network id (eip155:84532). */
  networkId: string;
  /** USDC contract address. */
  usdcAddress: string;
  /** x402 scheme id — default "exact"; "eip3009-client-broadcast" for Arc self-settle. */
  scheme?: string;
  /** Extra fields merged into requirements (e.g. assetTransferMethod hint). */
  extra?: Record<string, unknown>;
  /** Payment validity window in seconds (default: omitted). */
  maxTimeoutSeconds?: number;
  /** Free-tier requests per minute per agent token (default 1). */
  freePerMin?: number;
  /** Facilitator client — injectable for tests. */
  facilitator: BstockFacilitator;
  /** On-chain pass check — injectable for tests. */
  hasAccess: (wallet: string, serviceId: string) => Promise<boolean>;
  /** Pass mint/extend — injectable for tests. */
  mintPass: (
    to: string,
    serviceId: `0x${string}`,
    durationSec: number,
  ) => Promise<string>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function buildRequirements(
  cfg: BstockFreemiumConfig,
  resource: string,
): BstockPaymentRequirements {
  const baseUnits = (
    BigInt(Math.round(Number(cfg.priceUsd) * 1_000_000))
  ).toString();
  return {
    scheme: cfg.scheme ?? "exact",
    network: cfg.networkId,
    asset: cfg.usdcAddress,
    amount: baseUnits,
    payTo: cfg.payTo,
    maxAmountRequired: baseUnits,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    resource,
    description: "bstock-delta-realtime — 30d ServicePass",
    mimeType: "application/json",
    extra: cfg.extra,
  };
}

function paymentRequired(
  c: Context,
  requirements: BstockPaymentRequirements,
  error = "Payment required",
): Response {
  const payload = {
    x402Version: 2,
    error,
    accepts: requirements,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return c.json(payload, 402, { "PAYMENT-REQUIRED": encoded });
}

export function bstockFreemium(
  cfg: BstockFreemiumConfig,
): MiddlewareHandler {
  const freePerMin = cfg.freePerMin ?? 1;
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const resource = `${c.req.method} ${c.req.path}`;
    const requirements = buildRequirements(cfg, resource);

    // 1. Payment present → verify + settle + mint pass → proceed.
    const paymentSig = c.req.header("PAYMENT-SIGNATURE");
    if (paymentSig) {
      const verify = await cfg.facilitator.verify(paymentSig, requirements);
      if (!verify.valid) {
        return paymentRequired(
          c,
          requirements,
          verify.error ?? "Payment verification failed",
        );
      }
      const settle = await cfg.facilitator.settle(paymentSig, requirements);
      if (!settle.success) {
        return paymentRequired(
          c,
          requirements,
          settle.error ?? "Payment settlement failed",
        );
      }
      if (settle.payer) {
        try {
          await cfg.mintPass(settle.payer, cfg.serviceId, cfg.durationSec);
        } catch {
          // Mint failure must not block the paid request — pass minting
          // is retried on the next call (same as marketplace hook, D10).
        }
      }
      if (settle.transaction) {
        c.header("PAYMENT-RESPONSE", settle.transaction);
      }
      await next();
      return;
    }

    // 2. Live ServicePass → paid tier, skip the free bucket.
    const wallet = c.req.header("X-Wallet");
    if (wallet && (await cfg.hasAccess(wallet, cfg.serviceId))) {
      await next();
      return;
    }

    // 3. Free tier: freePerMin req/min per agent token → 402 over.
    const key = (c.get("agentId") as string | undefined) ?? "anonymous";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + 60_000 };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > freePerMin) {
      return paymentRequired(c, requirements);
    }
    await next();
  };
}
