// SLICE-223-5: x402 gateway wiring — pilot routes behind the new middleware.
// Flag: X402_GATEWAY_ENABLED=true + circle-payments runtime required
// (same pattern as marketplace: off → ungated, never fails closed).
//
// The middleware mounts on /api/v1/* and passes through every path not in
// the pilot registry — registration order vs other routes is irrelevant.
// Pilot routes are mounted here, AFTER the gate (Hono composes in order).

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";
import type {
  ResourceRegistry,
  UsageRecordStorePort,
} from "@agentbadge/payments";
import type {
  UsageRecordRow,
  UsageRecordStore,
} from "@agentbadge/database";

import { getConfig } from "../../config/env";
import { getDatabase } from "../lib/database";
import { bazaarExtensionFor } from "../lib/service-catalog/bazaar";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";
import {
  createX402PaymentService,
  x402GatewayMiddleware,
  type X402PaymentService,
} from "../lib/x402-gateway";
import { acceptsFor, createGatewayRegistry } from "../lib/x402-gateway/seed";
import { getAgentWalletStore } from "./agent-wallet";
import { getFxDeltaRuntime } from "../lib/fx-delta";
import {
  chainDisabled,
  passportChainEnabled,
} from "../lib/passport-chain-gate";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { passportRequestHandler } from "../routes/passport";
import { fxDeltaV1Routes } from "../routes/fx-delta-v1";

export interface X402GatewayWiringDeps {
  runtime?: CirclePaymentsRuntime;
  /** Test injection — skip env/DB construction. */
  service?: X402PaymentService;
  registry?: ResourceRegistry;
}

/** DB store → domain port: payload is JsonValue in the DB layer vs
 *  unknown at the domain edge (JSON round-trip at the boundary), and
 *  DB currency is optional where the domain requires it ("USDC" default). */
function toUsageRecordPort(store: UsageRecordStore): UsageRecordStorePort {
  const toPersisted = (r: UsageRecordRow | null) =>
    r ? { ...r, currency: r.currency ?? "USDC" } : null;
  const toList = async (p: Promise<UsageRecordRow[]>) =>
    (await p).map((r) => ({ ...r, currency: r.currency ?? "USDC" }));
  return {
    append: async (r) =>
      toPersisted(
        await store.append({
          ...r,
          payload: JSON.parse(JSON.stringify(r.payload ?? {})),
        }),
      ),
    getById: async (id) => toPersisted(await store.getById(id)),
    getByRequestId: async (id) => toPersisted(await store.getByRequestId(id)),
    listByPayment: (p) => toList(store.listByPayment(p)),
    listByAgent: (a, l) => toList(store.listByAgent(a, l)),
    listByResource: (res, l) => toList(store.listByResource(res, l)),
  };
}

/** M-6: wiring is idempotent per app — a second call must not stack
 *  another middleware + route set. */
const wiredApps = new WeakSet<Hono>();

export function wireX402Gateway(
  app: Hono,
  deps: X402GatewayWiringDeps = {},
): void {
  if (wiredApps.has(app)) return;
  if (process.env.X402_GATEWAY_ENABLED !== "true") return;
  if (!deps.runtime) {
    logger.warn(
      "x402-gateway: enabled but no circle-payments runtime — pilots ungated",
    );
    return;
  }
  wiredApps.add(app);
  const router = deps.runtime.router;
  const service =
    deps.service ??
    createX402PaymentService({
      router,
      usageRecords: toUsageRecordPort(getDatabase().payments.usageRecords),
      walletStore: getAgentWalletStore() ?? undefined,
      recipient:
        getConfig().marketplace?.treasury ?? process.env.X402_PAY_TO ?? "",
      bazaarExtensionFor,
    });
  const registry = deps.registry ?? createGatewayRegistry();

  app.use(
    "/api/v1/*",
    x402GatewayMiddleware({
      service,
      registry,
      serviceAcceptsFor: (amountAtomic) => acceptsFor(router, amountAtomic),
      bazaarExtensionFor,
      // H-3: refuse BEFORE the 402 challenge/settle when the handler
      // can't succeed — never charge for a request that ends in a 503.
      preCheck: (c) => {
        if (
          c.req.path === "/api/v1/fx/delta/premium" &&
          !getFxDeltaRuntime()
        ) {
          return errorResponse(
            c,
            503,
            ErrorCodes.INTERNAL_ERROR,
            "engine not started",
          );
        }
        if (
          c.req.path === "/api/v1/passport/request" &&
          !passportChainEnabled()
        ) {
          return chainDisabled(c);
        }
      },
    }),
  );

  // H-6: mount the SINGLE handler — `app.route("/api/v1", passportRoutes)`
  // would expose every future passport route under the paid prefix.
  // Same handler as legacy /passport/request; only the rail changed.
  app.post("/api/v1/passport/request", passportRequestHandler);
  // Pilot: /api/v1/fx/delta/premium — same snapshot as the Celo-gated
  // /api/fx-delta/premium, payment via the Arc gateway (SLICE-223-6).
  app.route("/", fxDeltaV1Routes);

  logger.info("x402 gateway wired: /api/v1 pilot routes behind gateway middleware");
}
