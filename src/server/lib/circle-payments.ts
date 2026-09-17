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
  createIdentityExtension,
  createMemoryFailureStore,
  createPaymentRouter,
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
  type SchemeHandle,
} from "@agentbadge/circle-payments";
import type { CirclePaymentsConfig } from "../../config/env";
import type { PaymentMiddleware } from "../routes/identity";

export interface CirclePaymentsRuntime {
  /** Router dispatching verify/settle to enabled rails */
  router: PaymentRouter;
  /** requirePayment bound to runtime opts — pass a PRICE_TABLE key */
  paymentFor(routeKey: string): PaymentMiddleware;
  /** Fulfillment-failure ledger (ops / MCP payment_history) */
  failureStore: FailureStore;
  /** 402 extensions builder — present only when identity flag on */
  identityExtension?: IdentityExtensionBuilder;
  /** Passport lookup for the identity route */
  lookup: IdentityLookup;
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
    arcSelfSettle?: SchemeHandle;
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

  return {
    router,
    failureStore,
    identityExtension,
    lookup,
    paymentFor(routeKey: string): PaymentMiddleware {
      const price = getPrice(routeKey);
      return requirePayment(price, {
        sellerAddress: cfg.sellerAddress,
        gateway: cfg.gateway,
        exact: true,
        arc: cfg.arc,
        handles,
        router,
        failureStore,
        onFailure: deps.onFailure,
        ...(identityExtension
          ? { extensions: () => identityExtension(cfg.sellerAddress) }
          : {}),
      }) as unknown as PaymentMiddleware;
    },
  };
}
