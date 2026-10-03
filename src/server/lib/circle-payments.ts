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
  createGatewayProbe,
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
  type GatewayProbe,
  type IdentityExtensionBuilder,
  type IdentityLookup,
  type PaymentRouter,
  type PaymentStatusLookup,
  type PriceResolver,
  type RequirePaymentOptions,
  type SchemeHandle,
  type ArcSelfSettleHandle,
  type BalanceLookup,
  type PaymentHistory,
} from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport";
import type { CirclePaymentsConfig } from "../../config/env";
import type { PaymentMiddleware } from "../routes/identity";
import { createSpendX402Hooks } from "./agent-wallet/x402-hooks";
import { buildCircleOpsLookups } from "./circle-payments-ops";

/** Extra per-route options exposed to wiring code (SLICE-156-1). */
export interface PaymentForOpts {
  /** Include the passport identity extension — default true when enabled */
  identity?: boolean;
  /** Override payTo (per-treasury routes: keeperhub, marketplace) */
  payTo?: string;
  /** HTTP methods to gate (default: all) */
  methods?: string[];
  /** Pre-challenge bypass — access-pass grant/deny */
  onBeforeChallenge?: RequirePaymentOptions["onBeforeChallenge"];
  /** Custom 402 JSON body (pack catalog) */
  unpaidBody?: RequirePaymentOptions["unpaidBody"];
  /** Canonical resource URL behind TLS proxy */
  resourceUrl?: RequirePaymentOptions["resourceUrl"];
  /** Settle hooks — composed after spend-envelope hooks */
  onBeforeSettle?: RequirePaymentOptions["onBeforeSettle"];
  onSettleResult?: RequirePaymentOptions["onSettleResult"];
  /** Resource description / MIME type in the 402 challenge */
  description?: string;
  mimeType?: string;
  /** 402 extensions (bazaar declaration) — overrides identity extension;
   *  pass `identity: false` to disable identity explicitly. */
  extensions?: RequirePaymentOptions["extensions"];
}

export interface CirclePaymentsRuntime {
  /** Router dispatching verify/settle to enabled rails */
  router: PaymentRouter;
  /** Router for a non-default payTo (keeperhub/marketplace treasuries) */
  routerFor(payTo: string): PaymentRouter;
  /** requirePayment bound to runtime opts — pass a PRICE_TABLE key */
  paymentFor(routeKey: string, opts?: PaymentForOpts): PaymentMiddleware;
  /** requirePayment bound to runtime opts — "$x.xx" price or a per-request
   *  resolver (scan-packs dynamic pack pricing, SLICE-156-1). */
  paymentForPrice(
    price: PriceResolver,
    opts?: PaymentForOpts,
  ): PaymentMiddleware;
  /** Gateway facilitator probe — present when gateway rail enabled (156-1) */
  gatewayProbe?: GatewayProbe;
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

  // SLICE-156-1: facilitator probe — background healthcheck + backoff.
  // The router's gateway flag is a dynamic getter on probe.isUp(), so a
  // dead facilitator degrades advertised accepts[] to vanilla rails.
  const gatewayProbe = cfg.gateway
    ? createGatewayProbe({
      apiUrl: cfg.gatewayApiUrl,
      ...(cfg.gatewayProbeMs ? { intervalMs: cfg.gatewayProbeMs } : {}),
      ...(cfg.gatewayDownMs ? { downMs: cfg.gatewayDownMs } : {}),
      onChange: (up, reason) =>
        up
          ? logger.info("gateway probe: rail back up", { reason })
          : logger.warn("gateway probe: rail down (vanilla accepts only)", {
            reason,
          }),
    })
    : undefined;

  /** Wrap a scheme handle so transport failures feed the probe. */
  function withProbe<T extends SchemeHandle>(h: T): T {
    if (!gatewayProbe) return h;
    const mark = (p: Promise<unknown>) =>
      p.catch((err) => {
        gatewayProbe.markFailure();
        throw err;
      });
    return {
      ...h,
      verify: (payload: unknown, req: never) => mark(h.verify(payload, req)),
      settle: (payload: unknown, req: never) => mark(h.settle(payload, req)),
    } as T;
  }

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
          gateway: withProbe(
            registerGatewayScheme(server, {
              facilitatorUrl: cfg.gatewayApiUrl,
              sellerAddress: cfg.sellerAddress,
              ...(cfg.gatewayChains ? { chains: cfg.gatewayChains } : {}),
            }),
          ),
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

  /** Router flags — gateway resolves through the probe getter. */
  const routerFlags = {
    gateway: gatewayProbe ? () => gatewayProbe.isUp() : cfg.gateway,
    exact: true,
    arc: cfg.arc,
  };

  const routers = new Map<string, PaymentRouter>();
  const routerFor = (payTo: string): PaymentRouter => {
    let r = routers.get(payTo);
    if (!r) {
      r = createPaymentRouter({
        sellerAddress: payTo,
        ...(cfg.gatewayChains ? { gatewayChains: cfg.gatewayChains } : {}),
        ...routerFlags,
        handles: handles!,
      });
      routers.set(payTo, r);
    }
    return r;
  };
  const router = routerFor(cfg.sellerAddress);

  const identityExtension = cfg.identity
    ? createIdentityExtension({ lookup })
    : undefined;

  // 129-16/18/20: ops lookups — extracted to circle-payments-ops.ts
  // (status, balance, payment history; gateway GET queries + failure ledger).
  const { statusLookup, balanceLookup, paymentHistory } =
    buildCircleOpsLookups({
      cfg,
      failureStore,
      arcSelfSettle: handles.arcSelfSettle,
    });

  return {
    router,
    routerFor,
    gatewayProbe,
    failureStore,
    identityExtension,
    lookup,
    statusLookup,
    balanceLookup,
    paymentHistory,
    paymentFor(routeKey: string, opts?: PaymentForOpts): PaymentMiddleware {
      return this.paymentForPrice(getPrice(routeKey), opts);
    },
    paymentForPrice(
      price: PriceResolver,
      opts?: PaymentForOpts,
    ): PaymentMiddleware {
      const withIdentity = opts?.identity !== false && identityExtension;
      // SLICE-155-4: spend-envelope hooks — pre-settle reserve on the
      // verified payer, settle/release after. Feature-off = no-ops.
      const spendHooks = createSpendX402Hooks();
      // Route-specific hooks compose after spend-envelope hooks (which
      // may deny pre-settle); both run, first Response aborts.
      const { payTo, methods, onBeforeChallenge, unpaidBody,
        resourceUrl, onBeforeSettle, onSettleResult, description,
        mimeType, extensions } = opts ?? {};
      const targetRouter = payTo ? routerFor(payTo) : router;
      return requirePayment(price, {
        sellerAddress: payTo ?? cfg.sellerAddress,
        ...routerFlags,
        ...(cfg.gatewayChains ? { gatewayChains: cfg.gatewayChains } : {}),
        handles,
        router: targetRouter,
        failureStore,
        onFailure: deps.onFailure,
        ...spendHooks,
        ...(methods ? { methods } : {}),
        ...(onBeforeChallenge ? { onBeforeChallenge } : {}),
        ...(unpaidBody ? { unpaidBody } : {}),
        ...(resourceUrl ? { resourceUrl } : {}),
        ...(description ? { description } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(onBeforeSettle || spendHooks.onBeforeSettle
          ? {
            onBeforeSettle: async (args) => {
              const deny = await spendHooks.onBeforeSettle?.(args);
              if (deny instanceof Response) return deny;
              return onBeforeSettle?.(args);
            },
          }
          : {}),
        ...(onSettleResult
          ? {
            onSettleResult: async (args) => {
              await spendHooks.onSettleResult?.(args);
              await onSettleResult(args);
            },
          }
          : {}),
        ...(extensions !== undefined
          ? { extensions }
          : withIdentity
            ? {
              extensions: () =>
                identityExtension!(payTo ?? cfg.sellerAddress),
            }
            : {}),
      }) as unknown as PaymentMiddleware;
    },
  };
}
