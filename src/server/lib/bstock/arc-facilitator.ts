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
  type TxHashStore,
  type ReceiptClient,
} from "@agentbadge/circle-payments";
import type {
  BstockFacilitator,
  BstockPaymentRequirements,
} from "../../middleware/bstock-freemium";
import { getCache } from "../cache";
import { getDatabase } from "../database";
import { CacheTxHashStore } from "./tx-hash-store";

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
  /**
   * Replay-protection store — default `CacheTxHashStore(getCache())`
   * (atomic `incr`, restart-safe on Upstash; in-memory when
   * `CACHE_ENABLED` is off). Ignored when `handle` is injected.
   */
  txHashStore?: TxHashStore;
  /** Injectable receipt client for tests (default-path handle). */
  publicClient?: ReceiptClient;
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
      publicClient: cfg.publicClient,
      txHashStore: cfg.txHashStore ?? new CacheTxHashStore(getCache()),
    });

  return {
    async verify(paymentHeader, requirements) {
      try {
        const res = await handle.verify(
          decodePaymentHeader(paymentHeader),
          toPaymentRequirements(requirements),
        );
        return { valid: res.isValid, error: res.invalidReason };
      } catch (err) {
        // RPC/receipt fetch failure → 402, not 500: the client can retry
        // (txHash is not claimed on inspect failure).
        return {
          valid: false,
          error: `verify_failed: ${(err as Error).message}`,
        };
      }
    },
    async settle(paymentHeader, requirements) {
      let res;
      try {
        res = await handle.settle(
          decodePaymentHeader(paymentHeader),
          toPaymentRequirements(requirements),
        );
      } catch (err) {
        return {
          success: false,
          error: `settle_failed: ${(err as Error).message}`,
        };
      }
      if (res.success && res.transaction) {
        // Audit trail — fire-and-forget; a failed write must not block
        // the paid request (same as pass-mint in the middleware).
        void Promise.resolve()
          .then(() =>
            getDatabase().events.create({
              type: "payment",
              source: "arc-x402",
              payload: {
                txHash: res.transaction,
                payer: res.payer ?? null,
                amount: requirements.amount,
                asset: requirements.asset,
                network: requirements.network,
              },
            }),
          )
          .catch(() => {});
      }
      return {
        success: res.success,
        transaction: res.transaction,
        payer: res.payer,
        error: res.errorReason,
      };
    },
  };
}
