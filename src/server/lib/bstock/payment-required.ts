/**
 * 402 PAYMENT-REQUIRED construction for bstockFreemium
 * (extracted SLICE-171-3 — middleware file stays under the line cap).
 *
 * EPIC-171: while the payer-binding gate is on, every 402 advertises
 * `payerBinding` (top-level + `accepts.extra`) so clients learn the
 * X-Wallet/X-Sig/X-Timestamp requirement before paying.
 */

import type { Context } from "hono";
import {
  payerBindingActive,
  PAYER_BINDING_DECLARATION,
} from "../../middleware/payer-binding";
import type {
  BstockFreemiumConfig,
  BstockPaymentRequirements,
} from "../../middleware/bstock-freemium";

export function buildRequirements(
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

export function paymentRequired(
  c: Context,
  requirements: BstockPaymentRequirements,
  cfg: BstockFreemiumConfig,
  error = "Payment required",
): Response {
  const bind = payerBindingActive(cfg.payerBinding);
  const accepts = bind
    ? {
        ...requirements,
        extra: {
          ...requirements.extra,
          payerBinding: PAYER_BINDING_DECLARATION,
        },
      }
    : requirements;
  const payload = {
    x402Version: 2,
    error,
    accepts,
    ...(bind ? { payerBinding: PAYER_BINDING_DECLARATION } : {}),
    ...(cfg.extensions ? { extensions: cfg.extensions } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  return c.json(payload, 402, { "PAYMENT-REQUIRED": encoded });
}
