// EPIC-140 (SLICE-140-4): marketplace x402 wiring extracted from index.ts.
// SLICE-157-3 (D1 + D6-157): legacy x402.org stack + inline Arc pre-middleware
// removed — both paid routes run on the circle-payments runtime.
//   - passport mint: static price, payTo → treasury, preFlight sig+meta check
//     (don't charge for requests that can't mint).
//   - service buy:   price resolver from path serviceId, per-rail payTo
//     (base exact/gateway → splitter 90/10, arc self-settle → treasury),
//     onSettleResult mints via the shared marketplace mint core.
// Order is security-relevant: payment middleware → api routes → page routes
// (Hono composes in registration order).

import type { Context, Hono, MiddlewareHandler } from "hono";
import { logger } from "@agentbadge/passport/logger";
import { getConfig } from "../../config/env";
import { bazaarExtensionFor } from "../lib/service-catalog/bazaar";
import { getDatabase } from "../lib/database";
import { initMarketplaceDbBackend } from "../lib/marketplace/db-backend";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { marketplaceApiRoutes } from "../routes/marketplace/marketplace-api";
import { marketplacePageRoutes } from "../routes/marketplace/marketplace-pages";
import {
  createMarketplaceMintOnPaymentSettled,
  getService as getMarketService,
  validatePassportMeta,
} from "../lib/marketplace";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";
import {
  payerBinding,
  PAYER_BINDING_DECLARATION,
} from "../middleware/payer-binding";
import {
  createArcPayerPeek,
  withPayerBindDecl,
} from "../lib/payer-binding-arc";
import { InMemoryUsageRecordStore } from "@agentbadge/payments";
import {
  createDbAgentWalletStore,
  createJsonAgentWalletStore,
} from "../lib/agent-wallet/registry.js";
import { createX402PaymentService } from "../lib/x402-gateway/service.js";
import { x402GatewayMiddleware } from "../lib/x402-gateway/middleware.js";
import {
  acceptsFor as gatewayAcceptsFor,
  createGatewayRegistry,
} from "../lib/x402-gateway/seed.js";

const BUY_PATH_RE = /\/api\/market\/buy\/(0x[0-9a-fA-F]{64})/;

function serviceIdFromPath(path: string): `0x${string}` | undefined {
  const m = BUY_PATH_RE.exec(path);
  return m ? (m[1].toLowerCase() as `0x${string}`) : undefined;
}

/** Buy price — resolved per request from the path's serviceId. Unknown
 *  serviceIds are aborted by buyPreCheck before this resolver matters. */
function buyPrice(c: Context): string {
  const id = serviceIdFromPath(c.req.path);
  const svc = id ? getMarketService(id) : undefined;
  return svc ? `$${svc.priceUsd}` : "$1"; // sentinel — unreachable in practice
}

/** Passport preFlight — same checks as legacy onProtectedRequest:
 *  valid wallet signature + valid passport metadata BEFORE the 402. */
async function passportPreCheck(c: Context): Promise<Response | void> {
  const sig = await verifyWalletSigRequest({
    wallet: c.req.header("x-wallet"),
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  if (sig !== "valid") {
    return c.json(
      { error: "valid X-Wallet/X-Sig/X-Timestamp required", detail: sig },
      400,
    );
  }
  let body: unknown;
  try {
    body = await c.req.raw.clone().json();
  } catch {
    body = undefined;
  }
  const v = validatePassportMeta(body);
  if (!v.ok) return c.json({ error: v.error }, 400);
}

/** Buy preFlight — service must exist in the catalog before we accept
 *  payment (was legacy onProtectedRequest "unknown serviceId" abort). */
function buyPreCheck(c: Context): Response | void {
  const id = serviceIdFromPath(c.req.path);
  if (!id || !getMarketService(id)) {
    return c.json({ error: "unknown serviceId" }, 404);
  }
}

export function wireMarketplace(
  app: Hono,
  deps: { runtime?: CirclePaymentsRuntime } = {},
): void {
  const marketplaceCfg = getConfig().marketplace;
  if (!marketplaceCfg?.enabled) return;

  // SLICE-155-12: Postgres catalog mirror — no-op when DATABASE_ENABLED off.
  initMarketplaceDbBackend(getDatabase().marketplace);

  // Payment gate — runtime + splitter (buy accept). Off → ungated
  // (testnet/dev convenience, same pattern as scanPacks.pricingEnabled).
  if (deps.runtime && marketplaceCfg.splitterAddress) {
    const runtime = deps.runtime;
    // EPIC-171: arc rail payTo is the treasury on both routes
    // (buy overrides via perRailPayTo) — peek resolves the on-chain
    // payer there; binding runs before paymentForPrice so a foreign
    // txHash never reaches verify/slot-claim.
    const arcPayerPeek = createArcPayerPeek(
      runtime.arcSelfSettle,
      marketplaceCfg.treasury,
    );

    app.use(
      "/api/market/passport",
      payerBinding({ group: "marketplace", resolvePayer: arcPayerPeek }),
    );
    // SLICE-223-5: passport mint migrates to the EPIC-223 gateway —
    // registry-driven 402 + seam settle + UsageRecord, same preCheck and
    // payerBinding chain. Treasury router keeps the original payTo.
    const treasuryRouter = runtime.routerFor(marketplaceCfg.treasury);
    const db = getDatabase();
    const gatewayExtensionsFor = (resourceId: string) => ({
      ...(bazaarExtensionFor("marketplace:passport-mint") ?? {}),
      payerBinding: PAYER_BINDING_DECLARATION,
      resourceId,
    });
    const gatewayService = createX402PaymentService({
      router: treasuryRouter,
      // v1 usage persistence is in-memory until @agentbadge/database
      // ships UsageRecordRepository (server dep bump pending).
      usageRecords: new InMemoryUsageRecordStore(),
      walletStore: db.agentWallets
        ? createDbAgentWalletStore(db.agentWallets)
        : createJsonAgentWalletStore(),
      recipient: marketplaceCfg.treasury,
      bazaarExtensionFor: gatewayExtensionsFor,
    });
    app.use(
      "/api/market/passport",
      x402GatewayMiddleware({
        service: gatewayService,
        registry: createGatewayRegistry(),
        serviceAcceptsFor: (amountAtomic) =>
          gatewayAcceptsFor(treasuryRouter, amountAtomic),
        preCheck: passportPreCheck,
      }),
    );

    app.use(
      "/api/market/buy/:serviceId",
      payerBinding({ group: "marketplace", resolvePayer: arcPayerPeek }),
    );
    app.use(
      "/api/market/buy/:serviceId",
      runtime.paymentForPrice(buyPrice, withPayerBindDecl({
        payTo: marketplaceCfg.splitterAddress,
        // D6-157: arc self-settle pays treasury (no splitter split);
        // base exact/gateway keep the splitter.
        perRailPayTo: { arcSelfSettle: marketplaceCfg.treasury },
        methods: ["POST"],
        description: "Marketplace service access pass",
        mimeType: "application/json",
        extensions: bazaarExtensionFor("marketplace:service-buy"),
        onBeforeChallenge: buyPreCheck,
        // 5A: mint fold — arc (scheme eip3009-client-broadcast) mints to
        // payer without credit; base credits splitter + mints.
        onSettleResult: createMarketplaceMintOnPaymentSettled(),
      }, "marketplace")) as MiddlewareHandler,
    );
    logger.info(
      "x402 middleware wired for marketplace (passport mint + service buy) via circle-payments runtime",
    );
  } else {
    // SLICE-234-20: fail-closed — without the payment rail the passport
    // mint and service buy handlers would run ungated (free mint →
    // registerService → paid surface bypass). EaaS pattern (wireEaas):
    // mount 503 stubs on the paid writes instead of exposing them.
    logger.warn(
      "marketplace: circle-payments runtime or splitter unavailable — /api/market paid routes mounted as 503 (fail-closed)",
    );
    const paidUnavailable = (c: Context) =>
      c.json(
        {
          error: "service_unavailable",
          message: "Payment rail not configured — paid routes disabled",
        },
        503,
      );
    app.use("/api/market/passport", async (c, next) => {
      if (c.req.method === "POST") return paidUnavailable(c);
      return next();
    });
    app.use("/api/market/buy/:serviceId", async (c, next) => {
      if (c.req.method === "POST") return paidUnavailable(c);
      return next();
    });
  }

  // Routes registered AFTER the payment middleware — Hono runs handlers in
  // registration order, so the gate must precede route handlers (139-3 fix).
  app.route("/api", marketplaceApiRoutes);
  app.route("/", marketplacePageRoutes); // SLICE-138-5: /market/* UI
}
