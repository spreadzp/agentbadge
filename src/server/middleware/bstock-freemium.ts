/**
 * bStock freemium gate (EPIC-141, SLICE-141-7; generalized SLICE-151-7).
 *
 * Free tier: 1 req/min per identity (X-Wallet → agentId → client IP)
 * → over the limit returns HTTP 402 with a PAYMENT-REQUIRED header
 * (base64 x402 requirements), so standard x402 clients can pay
 * automatically.
 *
 * Paid tier: X-Wallet holding a live ServicePass (hasAccess on Arc)
 * bypasses the free bucket — real-time access. Optional: omit
 * hasAccess/serviceId for per-request paid gates (attestation).
 *
 * Payment: PAYMENT-SIGNATURE (EIP-3009) → facilitator verify → settle
 * → mintServicePass (mints or extends, 30d; optional) → request
 * proceeds.
 *
 * Patterns: circle-payments requirePayment (402 + facilitator verify/settle),
 * marketplace hooks.ts (mintServicePass on settle),
 * agent-auth.ts (injectable hasAccess for tests).
 */

import { logger } from "@agentbadge/passport";
import type { Context, MiddlewareHandler } from "hono";
import { tryGetCache } from "../lib/cache";

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
  /** bytes32 service id in the marketplace catalog. Required only when
   *  hasAccess/mintPass are used — per-request paid gates (attestation
   *  x402, 151-7) don't register a service. */
  serviceId?: `0x${string}`;
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
  /** Free-tier requests per minute per identity (default 1). */
  freePerMin?: number;
  /** Facilitator client — injectable for tests. */
  facilitator: BstockFacilitator;
  /** On-chain pass check — injectable for tests. Omit to disable the
   *  X-Wallet bypass (per-request paid gates, 151-7). */
  hasAccess?: (wallet: string, serviceId: string) => Promise<boolean>;
  /** Pass mint/extend — injectable for tests. Omit for per-request
   *  paid access (payment grants this call, no pass minted, 151-7). */
  mintPass?: (
    to: string,
    serviceId: `0x${string}`,
    durationSec: number,
  ) => Promise<string>;
  /** 402 description (default: bstock ServicePass wording). */
  description?: string;
  /** 179-3: bazaar discovery extension merged into the 402 payload. */
  extensions?: Record<string, unknown>;
  /** SLICE-155-2: spend envelope enforcer getter — resolved lazily per
   *  request (init order-independent). Absent/null → pass-through. */
  spendEnvelope?: () => import("../lib/agent-wallet/enforcer").SpendEnforcer | null;
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
    description:
      cfg.description ?? "bstock-delta-realtime — 30d ServicePass",
    mimeType: "application/json",
    extra: cfg.extra,
  };
}

function paymentRequired(
  c: Context,
  requirements: BstockPaymentRequirements,
  cfg: BstockFreemiumConfig,
  error = "Payment required",
): Response {
  const payload = {
    x402Version: 2,
    error,
    accepts: requirements,
    ...(cfg.extensions ? { extensions: cfg.extensions } : {}),
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
          cfg,
          verify.error ?? "Payment verification failed",
        );
      }
      // SLICE-155-2: envelope check-then-settle — cap reservation before
      // money moves; released if settle fails.
      const enforcer = cfg.spendEnvelope?.();
      let begun: Awaited<ReturnType<NonNullable<typeof enforcer>["begin"]>> | null = null;
      if (enforcer) {
        const res = await enforcer.begin(
          c,
          Number(cfg.priceUsd),
          "x402",
          `bstock:${cfg.serviceId ?? c.req.path}`,
        );
        if (res instanceof Response) return res;
        begun = res;
      }
      const settle = await cfg.facilitator.settle(paymentSig, requirements);
      if (!settle.success) {
        if (enforcer && begun) {
          await enforcer.complete(begun, false, Number(cfg.priceUsd), "x402",
            `bstock:${cfg.serviceId ?? c.req.path}`);
        }
        return paymentRequired(
          c,
          requirements,
          cfg,
          settle.error ?? "Payment settlement failed",
        );
      }
      if (enforcer && begun) {
        await enforcer.complete(
          begun,
          true,
          Number(cfg.priceUsd),
          "x402",
          `bstock:${cfg.serviceId ?? c.req.path}`,
          settle.transaction ?? undefined,
        );
      }
      if (settle.payer && cfg.mintPass && cfg.serviceId) {
        try {
          await cfg.mintPass(settle.payer, cfg.serviceId, cfg.durationSec);
        } catch (err) {
          // Mint failure must not block the paid request — pass minting
          // is retried on the next call (same as marketplace hook, D10).
          // But it MUST be logged: a silent UnknownService/role revert
          // otherwise leaves the payer without a pass and no trace.
          logger.error("bstock-freemium: mintServicePass failed", {
            payer: settle.payer,
            serviceId: cfg.serviceId,
            err: String(err),
          });
        }
      }
      if (settle.transaction) {
        c.header("PAYMENT-RESPONSE", settle.transaction);
      }
      await next();
      return;
    }

    // 2. Live ServicePass → paid tier, skip the free bucket.
    //    Positive results cached 60s — a pass lives 30d, so a minute of
    //    staleness is safe and keeps the Arc RPC out of the hot path.
    //    Negatives are never cached (a just-paid wallet must not wait).
    const wallet = c.req.header("X-Wallet");
    if (wallet && cfg.hasAccess && cfg.serviceId) {
      const passKey = `bstock:pass:${wallet}:${cfg.serviceId}`;
      const cache = tryGetCache();
      const cached = cache ? await cache.get<string>(passKey) : null;
      if (
        cached === "1" ||
        (await cfg.hasAccess(wallet, cfg.serviceId))
      ) {
        if (cached !== "1" && cache) {
          await cache.set(passKey, "1", { ttlSec: 60 });
        }
        await next();
        return;
      }
    }

    // 3. Free tier: freePerMin req/min per identity → 402 over.
    //    Identity = X-Wallet → agentId (bearer) → client IP, so the gate
    //    also works for anonymous endpoints (attestation, 151-7).
    //    cache.incr is atomic across replicas (INCR+EXPIRE); on backend
    //    error it returns 0 → request passes (fail-open for rate limits).
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const key =
      wallet ??
      (c.get("agentId") as string | undefined) ??
      ip ??
      "anonymous";
    const cache = tryGetCache();
    let count: number;
    if (cache) {
      count = await cache.incr(`bstock:free:${key}`, 60);
    } else {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + 60_000 };
        buckets.set(key, b);
      }
      count = ++b.count;
    }
    if (count > freePerMin) {
      return paymentRequired(c, requirements, cfg);
    }
    await next();
  };
}
