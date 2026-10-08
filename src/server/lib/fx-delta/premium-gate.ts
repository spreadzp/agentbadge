/**
 * FX-delta premium x402 gate (EPIC-191, SLICE-191-6, D-191-8/9).
 *
 * PAYMENT-SIGNATURE present → facilitator verify → settle → serve.
 * Absent/invalid → 402 with accepts = USDC + USDT on eip155:42220.
 * Optional payer-binding (EPIC-171) behind PAYER_BIND_ENABLED.
 */

import type { Context, MiddlewareHandler } from "hono";
import { ErrorCodes } from "../error-codes";
import { errorResponse } from "../error-response";
import {
  CELO_X402_ASSETS,
  CELO_X402_NETWORK,
  CELO_X402_SCHEME,
} from "./celo-settle";
import { getFxDeltaFacilitator } from "./facilitator-env";
import type { BstockPaymentRequirements } from "../../middleware/bstock-freemium";
import { checkPayerBinding } from "../../middleware/payer-binding";

function priceBaseUnits(): string {
  const usd = process.env.FXDELTA_PRICE_USD ?? "0.005";
  return BigInt(Math.round(Number(usd) * 1_000_000)).toString();
}

export function premiumRequirements(
  c: Context,
  asset: `0x${string}`,
  extra?: Record<string, unknown>,
): BstockPaymentRequirements {
  const amount = priceBaseUnits();
  return {
    scheme: CELO_X402_SCHEME,
    network: CELO_X402_NETWORK,
    asset,
    amount,
    maxAmountRequired: amount,
    payTo: process.env.FXDELTA_PAY_TO ?? process.env.X402_PAY_TO ?? "",
    maxTimeoutSeconds: 300,
    resource: `${c.req.method} ${c.req.path}`,
    description: "fx-delta premium — real-time Celo FX corridor deltas",
    mimeType: "application/json",
    extra,
  };
}

function premium402(c: Context, error = "Payment required"): Response {
  const accepts = Object.values(CELO_X402_ASSETS).map((a) =>
    premiumRequirements(c, a.address as `0x${string}`, {
      name: a.name,
      version: a.version,
    }),
  );
  const payload = { x402Version: 2, error, accepts };
  return c.json(payload, 402, {
    "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(payload)).toString(
      "base64",
    ),
  });
}

/** Paid gate — verify+settle through the Celo facilitator. */
export function fxDeltaPremiumGate(): MiddlewareHandler {
  return async (c, next) => {
    const fac = getFxDeltaFacilitator();
    if (!fac) {
      return errorResponse(
        c,
        503,
        ErrorCodes.INTERNAL_ERROR,
        "premium not configured",
      );
    }
    const paymentSig = c.req.header("PAYMENT-SIGNATURE");
    if (!paymentSig) return premium402(c);

    // Payer-binding (EPIC-171): X-Wallet must match the auth payer.
    if (process.env.PAYER_BIND_ENABLED === "1") {
      const bound = await checkPayerBinding(c, {
        group: "fxdelta",
        resolvePayer: (h) =>
          fac.peekPayer!(
            h,
            premiumRequirements(c, CELO_X402_ASSETS.USDC.address),
          ),
      });
      if (!bound.ok) return bound.response;
    }

    const req = premiumRequirements(
      c,
      CELO_X402_ASSETS.USDC.address as `0x${string}`,
    );
    const verify = await fac.verify(paymentSig, req);
    if (!verify.valid) {
      return premium402(c, verify.error ?? "Payment verification failed");
    }
    const settle = await fac.settle(paymentSig, req);
    if (!settle.success) {
      return premium402(c, settle.error ?? "Payment settlement failed");
    }
    if (settle.transaction) {
      c.header("PAYMENT-RESPONSE", settle.transaction);
    }
    await next();
  };
}
