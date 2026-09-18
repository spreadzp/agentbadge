/**
 * SLICE-129-14: Circle payments server adapter.
 *
 * Reads CirclePaymentsConfig (env flags, D19) and constructs the
 * runtime: x402ResourceServer + enabled scheme registrars, payment
 * router, failure store, optional identity extension. Master flag off
 * → this module is never instantiated (zero behavior change).
 */

import { x402ResourceServer } from "@x402/core/server";
import {
  ARC_TESTNET,
  BASE_SEPOLIA,
  createBalanceLookup,
  createIdentityExtension,
  createMemoryFailureStore,
  createPaymentHistory,
  createPaymentRouter,
  createPaymentStatusLookup,
  getPrice,
  PRICE_TABLE,
  registerArcSelfSettleScheme,
  registerExactScheme,
  registerGatewayScheme,
  requirePayment,
  validatePriceTable,
  type FailureAlert,
  type FailureStore,
  type IdentityExtensionBuilder,
  type IdentityLookup,
  type PaymentRouter,
  type PaymentStatusLookup,
  type SchemeHandle,
  type ArcSelfSettleHandle,
  type BalanceLookup,
  type PaymentHistory,
} from "@agentbadge/circle-payments";
import type { CirclePaymentsConfig } from "../../config/env";
import type { PaymentMiddleware } from "../routes/identity";

export interface CirclePaymentsRuntime {
  /** Router dispatching verify/settle to enabled rails */
  router: PaymentRouter;
  /** requirePayment bound to runtime opts — pass a PRICE_TABLE key */
  paymentFor(
    routeKey: string,
    opts?: { identity?: boolean },
  ): PaymentMiddleware;
  /** Fulfillment-failure ledger (ops / MCP payment_history) */
  failureStore: FailureStore;
  /** 402 extensions builder — present only when identity flag on */
  identityExtension?: IdentityExtensionBuilder;
  /** Passport lookup for the identity route */
  lookup: IdentityLookup;
  /** Payment status lookup — any rail (129-16) */
  statusLookup: PaymentStatusLookup;
  /** Seller wallet + gateway balances per chain (129-18, ops) */
  balanceLookup: BalanceLookup;
  /** Settled + failed payment history (129-20, ops) */
  paymentHistory: PaymentHistory;
}

export interface CirclePaymentsDeps {
  /** Passport lookup (Hedera NFT + score); default → none found */
  identityLookup?: IdentityLookup;
  /** Ledger store; default in-memory */
  failureStore?: FailureStore;
  /** Alert hook — wire logger.error + Sentry captureError */
  onFailure?: FailureAlert;
  /** Injectable resource server (tests) */
  resourceServer?: x402ResourceServer;
  /** Injectable handles (tests) — skips real facilitator construction */
  handles?: {
    gateway?: SchemeHandle;
    exact?: SchemeHandle;
    arcSelfSettle?: ArcSelfSettleHandle;
  };
}

export function createCirclePaymentsRuntime(
  cfg: CirclePaymentsConfig,
  deps: CirclePaymentsDeps = {},
): CirclePaymentsRuntime {
  // Boot-time price validation — bad strings fail fast (D16)
  validatePriceTable(PRICE_TABLE);

  const failureStore = deps.failureStore ?? createMemoryFailureStore();
  const lookup = deps.identityLookup ?? (async () => undefined);

  let handles = deps.handles;
  if (!handles) {
    // Dual @x402/core installs (file: dep) — the resource server is only
    // used for register() side-effects; nominal type differs across the
    // two copies, so cast once at the boundary.
    const server = (deps.resourceServer ??
      new x402ResourceServer()) as never;
    handles = {
      // exact = baseline rail, always on when master enabled
      exact: registerExactScheme(server, {
        sellerAddress: cfg.sellerAddress,
      }),
      ...(cfg.gateway
        ? {
            gateway: registerGatewayScheme(server, {
              facilitatorUrl: cfg.gatewayApiUrl,
              sellerAddress: cfg.sellerAddress,
            }),
          }
        : {}),
      ...(cfg.arc
        ? {
            arcSelfSettle: registerArcSelfSettleScheme(server, {
              rpcUrl: cfg.arcRpcUrl,
              sellerAddress: cfg.sellerAddress,
            }),
          }
        : {}),
    };
  }

  const router = createPaymentRouter({
    sellerAddress: cfg.sellerAddress,
    gateway: cfg.gateway,
    exact: true,
    arc: cfg.arc,
    handles,
  });

  const identityExtension = cfg.identity
    ? createIdentityExtension({ lookup })
    : undefined;

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
    ...(handles.arcSelfSettle
      ? { arcSelfSettle: handles.arcSelfSettle }
      : {}),
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
    ...(handles.arcSelfSettle
      ? {
          publicClients: {
            [ARC_TESTNET.caip2]:
              handles.arcSelfSettle.publicClient as never,
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

  return {
    router,
    failureStore,
    identityExtension,
    lookup,
    statusLookup,
    balanceLookup,
    paymentHistory,
    paymentFor(
      routeKey: string,
      opts?: { identity?: boolean },
    ): PaymentMiddleware {
      const price = getPrice(routeKey);
      const withIdentity = opts?.identity !== false && identityExtension;
      return requirePayment(price, {
        sellerAddress: cfg.sellerAddress,
        gateway: cfg.gateway,
        exact: true,
        arc: cfg.arc,
        handles,
        router,
        failureStore,
        onFailure: deps.onFailure,
        ...(withIdentity
          ? { extensions: () => identityExtension!(cfg.sellerAddress) }
          : {}),
      }) as unknown as PaymentMiddleware;
    },
  };
}
