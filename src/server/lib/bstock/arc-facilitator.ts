/**
 * Arc self-settle facilitator adapter (SLICE-141-13).
 *
 * Wraps `ArcSelfSettleHandle` (circle-payments) into the
 * `BstockFacilitator` interface used by bstockFreemium. The client
 * broadcasts `transferWithAuthorization` on Arc itself and sends the
 * txHash in PAYMENT-SIGNATURE (base64 JSON `{payload:{txHash}}` or
 * `{txHash}`) — the handle verifies the on-chain receipt, no
 * facilitator service needed.
 */

import {
  createArcSelfSettleHandle,
  ARC_TESTNET,
  type ArcSelfSettleHandle,
  type PaymentRequirements,
} from "@agentbadge/circle-payments";
import type {
  BstockFacilitator,
  BstockPaymentRequirements,
} from "../../middleware/bstock-freemium";

/** Decode PAYMENT-SIGNATURE header → payload object for the handle. */
function decodePaymentHeader(header: string): unknown {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    // Not base64 JSON — pass through raw (handle returns missing_tx_hash).
    return header;
  }
}

function toPaymentRequirements(
  r: BstockPaymentRequirements,
): PaymentRequirements {
  return {
    scheme: r.scheme,
    network: r.network,
    asset: r.asset,
    amount: r.amount,
    maxAmountRequired: r.maxAmountRequired,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds ?? 345600,
    extra: r.extra,
  };
}

export interface ArcFacilitatorConfig {
  /** Treasury address receiving payments (payTo). */
  sellerAddress: string;
  /** Arc RPC — default ARC_RPC_URL env or ARC_TESTNET.rpcUrl. */
  rpcUrl?: string;
  /** Injectable handle for tests. */
  handle?: ArcSelfSettleHandle;
}

/**
 * BstockFacilitator backed by Arc on-chain receipt verification.
 * `handle` injectable for tests; default creates a real one via
 * createArcSelfSettleHandle (viem client on ARC_RPC_URL).
 */
export function createArcBstockFacilitator(
  cfg: ArcFacilitatorConfig,
): BstockFacilitator {
  const handle =
    cfg.handle ??
    createArcSelfSettleHandle({
      sellerAddress: cfg.sellerAddress,
      chain: ARC_TESTNET,
      rpcUrl: cfg.rpcUrl ?? process.env.ARC_RPC_URL,
    });

  return {
    async verify(paymentHeader, requirements) {
      const res = await handle.verify(
        decodePaymentHeader(paymentHeader),
        toPaymentRequirements(requirements),
      );
      return { valid: res.isValid, error: res.invalidReason };
    },
    async settle(paymentHeader, requirements) {
      const res = await handle.settle(
        decodePaymentHeader(paymentHeader),
        toPaymentRequirements(requirements),
      );
      return {
        success: res.success,
        transaction: res.transaction,
        payer: res.payer,
        error: res.errorReason,
      };
    },
  };
}
