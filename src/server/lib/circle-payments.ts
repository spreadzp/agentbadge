/**
 * SLICE-129-14: Circle payments server adapter — reads
 * CirclePaymentsConfig and constructs the runtime (resource server +
 * scheme registrars, router, failure store, identity extension).
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
  type PaymentInfo,
  type PaymentMetricsHooks,
} from "@agentbadge/circle-payments";
import type { CirclePaymentsConfig } from "../../config/env";
import type { PaymentMiddleware } from "../routes/identity";
import { createSpendX402Hooks } from "./agent-wallet/x402-hooks";
import { buildCircleOpsLookups } from "./circle-payments-ops";
import {
  createGatewayProbeForCfg,
  withProbe,
} from "./circle-payments-probe";
import {
  resolvePaymentMetrics,
  routePriceUsd,
} from "../metrics/payments";

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
  /** Settle hooks — composed after spend-envelope hooks (155-4). */
  onBeforeSettle?: RequirePaymentOptions["onBeforeSettle"];
  onSettleResult?: RequirePaymentOptions["onSettleResult"];
  /** Resource description / MIME type in the 402 challenge */
  description?: string;
  mimeType?: string;
  /** 402 extensions (bazaar); `identity: false` disables identity. */
  extensions?: RequirePaymentOptions["extensions"];
  /** SLICE-157-1: v1 `X-PAYMENT` header opt-in (x402-base migration routes). */
  legacyHeader?: boolean;
  /** SLICE-157-1: merged into every accepts[].extra (e.g. paymentFlow). */
  extraRequirements?: Record<string, unknown>;
  /** SLICE-157-3: per-rail payTo override (unset rails keep payTo). */
  perRailPayTo?: RailPayTo;
}

export type RailPayTo = Partial<Record<"gateway" | "exact" | "arcSelfSettle", string>>;

export interface CirclePaymentsRuntime {
  /** Router dispatching verify/settle to enabled rails */
  router: PaymentRouter;
  /** Router for a non-default payTo (keeperhub/marketplace treasuries) */
  routerFor(payTo: string, perRailPayTo?: RailPayTo): PaymentRouter;
  /** requirePayment bound to runtime opts — pass a PRICE_TABLE key */
  paymentFor(routeKey: string, opts?: PaymentForOpts): PaymentMiddleware;
  /** requirePayment — "$x.xx" price or per-request resolver (156-1). */
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
  /** Arc self-settle handle — payer-binding `inspect` peek (EPIC-171). */
  arcSelfSettle?: ArcSelfSettleHandle;
}

export interface CirclePaymentsDeps {
  /** Passport lookup (Hedera NFT + score); default → none found */
  identityLookup?: IdentityLookup;
  /** Ledger store; default in-memory */
  failureStore?: FailureStore;
  /** Alert hook — wire logger.error + Sentry captureError */
  onFailure?: FailureAlert;
  /** SLICE-156-3: settle recorder — on every ok settle */
  recordSettle?: (p: PaymentInfo, path: string, to: `0x${string}`) => void;
  /** SLICE-160-1: metrics hooks injected into every router (verify/
   *  settle counters + duration histograms). Pass
   *  `createPaymentMetrics().hooks` or a test spy; default = none. */
  metrics?: PaymentMetricsHooks;
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

  // SLICE-160-1: payment metrics — prom counters live server-side,
  // package calls hooks only (D1-160). Metrics are always on when the
  // runtime is on; tests may inject spies via deps.metrics.
  const { hooks: metricsHooks, onFailure: onFailureAlert } =
    resolvePaymentMetrics(deps.metrics, deps.onFailure);

  // 156-1: facilitator probe — on failure the gateway flag degrades
  // advertised accepts[] to vanilla rails (extracted to *-probe.ts).
  const gatewayProbe = createGatewayProbeForCfg(cfg);

  let handles = deps.handles;
  if (!handles) {
    // Dual @x402/core installs (file: dep) — resource server used only
    // for register() side-effects; cast once at the boundary.
    const server = (deps.resourceServer ??
      new x402ResourceServer()) as never;
    handles = {
      // exact = baseline rail, always on when master enabled
      exact: registerExactScheme(server, {
        sellerAddress: cfg.sellerAddress,
      }),
      ...(cfg.gateway
        ? {
          gateway: withProbe(gatewayProbe, registerGatewayScheme(server, {
            facilitatorUrl: cfg.gatewayApiUrl,
            sellerAddress: cfg.sellerAddress,
            ...(cfg.gatewayChains ? { chains: cfg.gatewayChains } : {}),
          })),
        }
        : {}),
      ...(cfg.arc
        ? {
          arcSelfSettle: registerArcSelfSettleScheme(server, {
            rpcUrl: cfg.arcRpcUrl, sellerAddress: cfg.sellerAddress,
          }),
        }
        : {}),
    };
  }

  /** Router flags — gateway resolves via the probe getter. */
  const routerFlags = {
    gateway: gatewayProbe ? () => gatewayProbe.isUp() : cfg.gateway,
    exact: true,
    arc: cfg.arc,
  };

  const routers = new Map<string, PaymentRouter>();
  const routerFor = (payTo: string, perRailPayTo?: RailPayTo): PaymentRouter => {
    const key = perRailPayTo ? `${payTo}|${JSON.stringify(perRailPayTo)}` : payTo;
    let r = routers.get(key);
    if (!r) {
      r = createPaymentRouter({
        sellerAddress: payTo, gatewayCrosschainTakeUsd: cfg.gatewayCrosschainTakeUsd,
        ...(perRailPayTo ? { railPayTo: perRailPayTo } : {}),
        ...(cfg.gatewayChains ? { gatewayChains: cfg.gatewayChains } : {}),
        ...routerFlags,
        handles: handles!,
        metrics: metricsHooks,
      });
      routers.set(key, r);
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
    statusLookup, balanceLookup,
    paymentHistory, arcSelfSettle: handles.arcSelfSettle,
    paymentFor(routeKey: string, opts?: PaymentForOpts): PaymentMiddleware {
      // SLICE-160-1: route price gauge — low-cardinality PRICE_TABLE key.
      const priceUsd = Number(
        String(getPrice(routeKey)).replace(/^\$/, ""),
      );
      if (Number.isFinite(priceUsd)) {
        routePriceUsd.set({ route_key: routeKey }, priceUsd);
      }
      return this.paymentForPrice(getPrice(routeKey), opts);
    },
    paymentForPrice(
      price: PriceResolver,
      opts?: PaymentForOpts,
    ): PaymentMiddleware {
      const withIdentity = opts?.identity !== false && identityExtension;
      // 155-4: spend-envelope hooks (feature-off = no-ops).
      const spendHooks = createSpendX402Hooks();
      // Route hooks compose after spend-envelope hooks; first Response aborts.
      const { payTo, methods, onBeforeChallenge, unpaidBody,
        resourceUrl, onBeforeSettle, onSettleResult, description,
        mimeType, extensions, legacyHeader, extraRequirements,
        perRailPayTo } = opts ?? {};
      const targetRouter = payTo || perRailPayTo
        ? routerFor(payTo ?? cfg.sellerAddress, perRailPayTo)
        : router;
      return requirePayment(price, {
        sellerAddress: payTo ?? cfg.sellerAddress,
        ...routerFlags,
        ...(cfg.gatewayChains ? { gatewayChains: cfg.gatewayChains } : {}),
        handles,
        router: targetRouter,
        failureStore,
        onFailure: onFailureAlert,
        ...spendHooks,
        ...(methods ? { methods } : {}),
        ...(onBeforeChallenge ? { onBeforeChallenge } : {}),
        ...(unpaidBody ? { unpaidBody } : {}),
        ...(resourceUrl ? { resourceUrl } : {}),
        ...(description ? { description } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(legacyHeader ? { legacyHeader } : {}),
        ...(extraRequirements ? { extraRequirements } : {}),
        ...(onBeforeSettle || spendHooks.onBeforeSettle
          ? {
            onBeforeSettle: async (args) => {
              const deny = await spendHooks.onBeforeSettle?.(args);
              if (deny instanceof Response) return deny;
              return onBeforeSettle?.(args);
            },
          }
          : {}),
        onSettleResult: async (args) => {
          await spendHooks.onSettleResult?.(args);
          if (args.ok && args.payment)
            deps.recordSettle?.(args.payment, args.c.req.path,
              (payTo ?? cfg.sellerAddress) as `0x${string}`);
          await onSettleResult?.(args);
        },
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
