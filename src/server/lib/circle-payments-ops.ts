/**
 * SLICE-156-1: ops lookups extracted from circle-payments.ts (max-lines).
 *
 * Read-only gateways into the Circle facilitator API + failure ledger —
 * status lookup (129-16), balance lookup (129-18), payment history
 * (129-20). No privateKey: all endpoints are GET queries.
 */

import {
  ARC_TESTNET,
  BASE_SEPOLIA,
  createBalanceLookup,
  createPaymentHistory,
  createPaymentStatusLookup,
  type ArcSelfSettleHandle,
  type BalanceLookup,
  type FailureStore,
  type PaymentHistory,
  type PaymentStatusLookup,
} from "@agentbadge/circle-payments";
import type { CirclePaymentsConfig } from "../../config/env";

export interface CircleOpsLookups {
  statusLookup: PaymentStatusLookup;
  balanceLookup: BalanceLookup;
  paymentHistory: PaymentHistory;
}

export function buildCircleOpsLookups(args: {
  cfg: CirclePaymentsConfig;
  failureStore: FailureStore;
  arcSelfSettle?: ArcSelfSettleHandle;
}): CircleOpsLookups {
  const { cfg, failureStore, arcSelfSettle } = args;

  // 129-16: status lookup — thin read-only gateway transfer query
  // (GET {api}/x402/transfers/{id}); no privateKey needed.
  const statusLookup = createPaymentStatusLookup({
    ...(cfg.gateway
      ? {
        gatewayTransfers: {
          getTransferById: async (id: string) => {
            const resp = await fetch(
              `${cfg.gatewayApiUrl}/x402/transfers/${encodeURIComponent(id)}`,
            );
            if (!resp.ok) {
              throw new Error(`gateway transfer lookup ${resp.status}`);
            }
            return resp.json();
          },
        },
      }
      : {}),
    ...(arcSelfSettle ? { arcSelfSettle } : {}),
    failureStore,
  });

  // 129-18: ops balance lookup — chains = union of enabled rails
  // (exact → Base Sepolia always; gateway/arc → + Arc Testnet).
  const balanceChains = [
    BASE_SEPOLIA,
    ...(cfg.gateway || cfg.arc ? [ARC_TESTNET] : []),
  ];
  const balanceLookup = createBalanceLookup({
    chains: balanceChains,
    sellerAddress: cfg.sellerAddress,
    ...(cfg.gateway ? { gatewayApiUrl: cfg.gatewayApiUrl } : {}),
    ...(arcSelfSettle
      ? {
        publicClients: {
          [ARC_TESTNET.caip2]: arcSelfSettle.publicClient as never,
        },
      }
      : {}),
  });

  // 129-20: ops history — settled gateway transfers + failure ledger
  const paymentHistory = createPaymentHistory({
    failureStore,
    sellerAddress: cfg.sellerAddress,
    ...(cfg.gateway
      ? {
        gatewayTransfers: {
          searchTransfers: async (params: {
            to?: string;
            network?: string;
            status?: string;
            pageSize?: number;
          }) => {
            const q = new URLSearchParams();
            if (params.to) q.set("to", params.to);
            if (params.network) q.set("network", params.network);
            if (params.status) q.set("status", params.status);
            if (params.pageSize) q.set("pageSize", String(params.pageSize));
            const qs = q.toString().replaceAll("%3A", ":");
            const resp = await fetch(
              `${cfg.gatewayApiUrl}/x402/transfers${qs ? `?${qs}` : ""}`,
            );
            if (!resp.ok) {
              throw new Error(`gateway transfers search ${resp.status}`);
            }
            return resp.json();
          },
        },
      }
      : {}),
  });

  return { statusLookup, balanceLookup, paymentHistory };
}
