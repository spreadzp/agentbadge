/**
 * SLICE-154-5: EaaS billing tier routes.
 *
 *   POST /api/eaas/subscribe    — x402 settle → mintOrExtend(CLASS_EAAS)
 *                                 + EaasSubscription row (quota window).
 *   GET  /api/eaas/subscription — public status read: ?wallet=0x…
 *                                 → {tier, quota, quotaUsed, expiresAt,
 *                                    resetAt} or {subscribed:false}.
 *
 * Subscribe pipeline: validate tier (400) → rate-limit (429) → x402
 * (402/settle) → mint + record. The mint is awaited so hasAccess() is
 * true before the subscriber's first gated call; a mint failure returns
 * 502 but the payment is settled — same fail-open-for-user semantics as
 * createMintOnSettleHook (subscription row is still recorded so support
 * can re-mint without recharging).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isAddress } from "viem";
import { logger } from "@agentbadge/passport";
import {
  CLASS_EAAS,
  durationSecondsForAmount,
  type MinterFn,
} from "../lib/access-pass-minter";
import {
  createRateLimiter,
  consumerKey,
  type EaasVariables,
} from "../lib/eaas/request";
import {
  recordSubscription,
  type EaasSubscriptionStore,
  type EaasTierMap,
} from "../lib/eaas/subscription";
import type { PaymentMiddleware } from "./identity";

export interface EaasBillingDeps {
  /** tier → "$x.xx" price (built from cfg.tierBasicUsd/tierProUsd). */
  tierPrices: Record<string, string>;
  /** tier → {quota, policies} (cfg.tierQuotas). */
  tiers: EaasTierMap;
  /** Explicit-price x402 middleware factory. */
  paymentForPrice: (priceUsd: string) => PaymentMiddleware;
  /** Mint/extend the CLASS_EAAS pass — resolveAccessPassMinter() in prod. */
  minter: MinterFn;
  store: EaasSubscriptionStore;
  rateRpm: number;
}

export function createEaasBillingRoutes(
  deps: EaasBillingDeps,
): Hono<{ Variables: EaasVariables }> {
  const routes = new Hono<{ Variables: EaasVariables }>();
  const limiter = createRateLimiter(deps.rateRpm);

  const paymentCache = new Map<string, PaymentMiddleware>();
  const paymentFor = (tier: string): PaymentMiddleware | null => {
    const price = deps.tierPrices[tier];
    if (!price) return null;
    let mw = paymentCache.get(price);
    if (!mw) {
      mw = deps.paymentForPrice(price);
      paymentCache.set(price, mw);
    }
    return mw;
  };

  routes.post(
    "/api/eaas/subscribe",
    describeRoute({
      description:
        "Subscribe to an EaaS billing tier: x402 payment mints/extends a CLASS_EAAS AccessPassNFT and opens a 30d verdict quota",
      responses: {
        200: { description: "{subscription, mintTx, paymentTx}" },
        400: { description: "Unknown tier / invalid body" },
        402: { description: "Payment required (x402)" },
        429: { description: "Rate limit exceeded" },
        502: { description: "Payment settled but pass mint failed" },
      },
    }),
    async (c, next) => {
      const body = (await c.req.json().catch(() => null)) as
        | { tier?: unknown }
        | null;
      const tier = typeof body?.tier === "string" ? body.tier : "basic";
      if (!deps.tierPrices[tier]) {
        return c.json(
          {
            error: `unknown tier "${tier}"`,
            tiers: Object.keys(deps.tierPrices),
          },
          400,
        );
      }
      c.set("eaasTier", tier);
      return next();
    },
    async (c, next) => {
      if (!limiter.allow(`sub:${consumerKey(c)}`)) {
        return c.json({ error: "rate limit exceeded" }, 429);
      }
      return next();
    },
    async (c, next) => {
      const tier = c.get("eaasTier") as string;
      return paymentFor(tier)!(c, next);
    },
    async (c) => {
      const tier = c.get("eaasTier") as string;
      const payment = c.get("payment");
      const payer = payment?.payer;
      if (!payer || !isAddress(payer)) {
        return c.json({ error: "settle did not return a payer wallet" }, 502);
      }
      const amount = payment.amount ?? "0";
      const durationSec = durationSecondsForAmount(amount, CLASS_EAAS);
      let mintTx: string | undefined;
      try {
        mintTx = await deps.minter({
          to: payer,
          classMask: CLASS_EAAS,
          durationSec,
          agentId: 0n,
          paymentTx: payment.transaction,
        });
      } catch (err) {
        logger.error("eaas: subscribe mint failed after settle", {
          payer,
          tier,
          err: String(err),
          paymentTx: payment.transaction,
        });
        // Still record the subscription so quota works even if the chain
        // mint has to be replayed — the payer already paid.
        const sub = recordSubscription({
          store: deps.store,
          wallet: payer,
          tier,
          durationSec,
          paymentTx: payment.transaction,
        });
        return c.json(
          {
            subscription: sub,
            mintTx: null,
            mintError: String(err),
            paymentTx: payment.transaction,
          },
          502,
        );
      }
      const sub = recordSubscription({
        store: deps.store,
        wallet: payer,
        tier,
        durationSec,
        paymentTx: payment.transaction,
        mintTx,
      });
      return c.json({
        subscription: sub,
        mintTx,
        paymentTx: payment.transaction,
      });
    },
  );

  routes.get(
    "/api/eaas/subscription",
    describeRoute({
      description:
        "Subscription status for a wallet (public): tier, quota, expiresAt, resetAt",
      responses: {
        200: { description: "{subscribed, tier?, quota?, quotaUsed?, expiresAt?, resetAt?}" },
        400: { description: "wallet query param required" },
      },
    }),
    (c) => {
      const wallet = c.req.query("wallet");
      if (!wallet || !isAddress(wallet)) {
        return c.json({ error: "wallet=0x… query param required" }, 400);
      }
      const sub = deps.store.get(wallet.toLowerCase());
      if (!sub) return c.json({ subscribed: false });
      const now = Math.floor(Date.now() / 1000);
      const tier = deps.tiers[sub.tier];
      return c.json({
        subscribed: sub.expiresAt > now,
        tier: sub.tier,
        quota: tier?.quota ?? 0,
        quotaUsed: sub.quotaUsed,
        quotaLeft: tier ? Math.max(0, tier.quota - sub.quotaUsed) : 0,
        expiresAt: sub.expiresAt,
        resetAt: sub.resetAt,
        paymentTx: sub.paymentTx,
        mintTx: sub.mintTx,
      });
    },
  );

  return routes;
}
