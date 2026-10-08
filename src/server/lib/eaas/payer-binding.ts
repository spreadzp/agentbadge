/**
 * EPIC-171 (SLICE-171-4): EaaS payer-binding wiring — extracted to keep
 * wiring/eaas.ts under the line cap.
 *
 * `mountEaasPayerBinding` registers the binding middleware on every paid
 * EaaS path BEFORE the route factories mount (Hono composes app.use
 * first) — rejects foreign txHash before any verify (dedup slot safe).
 * Arc payTo = runtime sellerAddress (default router, no perRailPayTo).
 *
 * `eaasBoundPaymentFor` wraps the route factories' injected
 * paymentForPrice: 402 gets the `payerBinding` declaration
 * (extensions live + accepts[].extra at mount) and onBeforeSettle gains
 * the post-verify payer compare.
 */

import type { Hono } from "hono";
import { payerBinding } from "../../middleware/payer-binding";
import {
  createArcPayerPeek,
  withPayerBindDecl,
} from "../payer-binding-arc";
import type { CirclePaymentsRuntime } from "../circle-payments";
import type { PaymentMiddleware } from "../../routes/identity";

/** Route factories' narrow paymentForPrice dep shape (priceUsd + bazaar
 *  extensions only). The wrapper still accepts the full PaymentForOpts
 *  fields the factories may add later. */
export type EaasPaymentFor = (
  priceUsd: string,
  opts?: { extensions?: Record<string, unknown> },
) => PaymentMiddleware;

/** Paid EaaS paths — binding middleware mounts before each route group. */
const EAAS_PAID_PATHS = [
  "/api/eaas/verdicts",
  "/api/eaas/subscribe",
  "/api/eaas/jobs/evaluate",
] as const;

/** Mounts binding on all paid paths; returns the wrapped
 *  paymentForPrice factory for the route factories. */
export function mountEaasPayerBinding(
  app: Hono,
  runtime: CirclePaymentsRuntime,
  sellerAddress: string,
): EaasPaymentFor {
  const arcPayerPeek = createArcPayerPeek(
    runtime.arcSelfSettle,
    sellerAddress,
  );
  for (const path of EAAS_PAID_PATHS) {
    app.use(path, payerBinding({ group: "eaas", resolvePayer: arcPayerPeek }));
  }
  return (priceUsd, opts) =>
    runtime.paymentForPrice(
      priceUsd,
      withPayerBindDecl(opts ?? {}, "eaas"),
    );
}

export function eaasBoundPaymentFor(
  runtime: CirclePaymentsRuntime,
): EaasPaymentFor {
  return (priceUsd, opts) =>
    runtime.paymentForPrice(
      priceUsd,
      withPayerBindDecl(opts ?? {}, "eaas"),
    );
}
