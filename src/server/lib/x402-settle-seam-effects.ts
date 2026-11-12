/**
 * SLICE-242-10: settle-seam side effects, extracted to keep
 * x402-settle-seam.ts under the 300-line lint cap.
 *
 * - recordSettled(): post-settle econ-ledger leg + success log + notify
 *   (fire-and-forget) — moved here verbatim from the seam.
 * - logVerifyFailure(): verify-fail is user noise — log only (D-242-15).
 * - reportSettleFailure(): settle-fail after a valid verify = lost money —
 *   log + deduped operator alert (D-242-15).
 */

import type {
  PaymentRequirements,
  PaymentRouter,
} from "@agentbadge/circle-payments";
import { emitX402Settle } from "./econ-ledger/x402.js";
import { notifyX402Payment } from "../services/payment-notification.js";
import { alertSettleFailure } from "../services/settle-failure-alert.js";
import { logger } from "@agentbadge/passport/logger";
import type { SettleSeamOptions } from "./x402-settle-seam";

/** Minimal structural view of the seam's VerifiedPayment (kept private there). */
export interface SeamVerifiedLike {
  payer: `0x${string}`;
  requirements: PaymentRequirements;
}

export function logVerifyFailure(reason: string, resource: string): void {
  logger.error("x402-settle-seam: payment verification failed", {
    reason,
    resource,
  });
}

export function reportSettleFailure(
  v: SeamVerifiedLike,
  opts: SettleSeamOptions,
  reason: string,
): void {
  logger.error("x402-settle-seam: payment settlement failed", {
    reason,
    payer: v.payer,
    amountAtomic: v.requirements.amount,
    resource: opts.resourceUrl,
    network: v.requirements.network,
  });
  void alertSettleFailure({
    reason,
    endpoint: opts.resourceUrl,
    payer: v.payer,
    amountAtomic: v.requirements.amount,
    network: v.requirements.network,
  });
}

export function recordSettled(
  v: SeamVerifiedLike,
  settle: Awaited<ReturnType<PaymentRouter["settle"]>>,
  opts: SettleSeamOptions,
  payer: `0x${string}`,
): void {
  const leg = {
    payer,
    payTo: v.requirements.payTo,
    amountAtomic: v.requirements.amount,
    tx: settle.transaction,
    network: v.requirements.network,
    scheme: v.requirements.scheme,
    resource: opts.resourceUrl,
  };
  emitX402Settle(leg);
  logger.info("x402-settle-seam: payment settled", {
    ...leg,
    resource: opts.resourceUrl,
  });
  void notifyX402Payment({ ...leg, resource: opts.resourceUrl });
}
