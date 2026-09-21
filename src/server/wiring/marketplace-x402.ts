// EPIC-140 (SLICE-140-4): marketplace x402 wiring extracted from index.ts.
// Covers: marketplaceCfg gate + facilitator check, marketResourceServer +
// ExactEvmScheme + onAfterSettle, Arc self-settle scheme + inline pre-middleware,
// marketRoutes402, onProtectedRequest, paymentMiddlewareFromHTTPServer, and the
// marketplaceApiRoutes/marketplacePageRoutes mounts (inside the enabled gate).
// Order inside is security-relevant: arc self-settle handler → x402 middleware →
// api routes → page routes (SLICE-138/139 comments preserved).

import type { Hono } from "hono";
import { paymentMiddlewareFromHTTPServer, x402ResourceServer, x402HTTPResourceServer, type SchemeNetworkServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import { registerArcSelfSettleScheme } from "@agentbadge/circle-payments";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { marketplaceApiRoutes } from "../routes/marketplace-api";
import { marketplacePageRoutes } from "../routes/marketplace-pages";
import {
  createMarketplaceMintOnSettleHook,
  getMarketplaceOps,
  getService as getMarketService,
  validatePassportMeta,
} from "../lib/marketplace";

export function wireMarketplace(app: Hono): void {
  // EPIC-138, SLICE-138-3: marketplace routes — gated by marketplace.enabled.
  // x402 gating (passport mint + service buy) activates only when a
  // facilitator is configured; without it the endpoints run ungated
  // (testnet/dev convenience, same pattern as scanPacks.pricingEnabled).
  const marketplaceCfg = getConfig().marketplace;
  if (marketplaceCfg?.enabled) {
    const marketFacilitatorUrl =
      process.env.X402_FACILITATOR_URL ?? getConfig().x402FacilitatorUrl;
    if (marketFacilitatorUrl && marketplaceCfg.splitterAddress) {
      try {
        const marketFacilitator = new HTTPFacilitatorClient({
          url: marketFacilitatorUrl,
        });
        const marketResourceServer = new x402ResourceServer(marketFacilitator)
          .register(
            "eip155:84532",
            new ExactEvmScheme() as unknown as SchemeNetworkServer,
          )
          // Settled buy → credit splitter (90/10) + mint service pass.
          .onAfterSettle(createMarketplaceMintOnSettleHook());
        // SLICE-139-7: Arc self-settle rail — AA/SCA buyers pay on
        // Arc (eip3009-client-broadcast). payer = Transfer.from = SCA.
        // Registers the scheme AND returns the verify/settle handle used
        // by the pre-middleware below. `as never` — server's @x402/core
        // differs from circle-payments' (private facilitatorClients).
        const arcSelfSettle = registerArcSelfSettleScheme(
          marketResourceServer as never,
          { sellerAddress: marketplaceCfg.treasury },
        );
        const marketRoutes402 = {
          "POST /api/market/passport": {
            accepts: [
              {
                scheme: "exact",
                network: "eip155:84532" as const,
                payTo: marketplaceCfg.treasury,
                price: `$${marketplaceCfg.passportPriceUsd}`,
              },
            ],
            description: "AgentBadge Business Passport — yearly marketplace access",
            mimeType: "application/json",
          },
          "POST /api/market/buy/:serviceId": {
            accepts: [
              {
                scheme: "exact",
                network: "eip155:84532" as const,
                // USDC lands on the splitter; afterSettle credits the service.
                payTo: marketplaceCfg.splitterAddress,
                price: async (ctx: { path: string }) => {
                  const m = /\/api\/market\/buy\/(0x[0-9a-fA-F]{64})/.exec(
                    ctx.path,
                  );
                  const svc = m ? getMarketService(m[1]) : undefined;
                  return svc ? `$${svc.priceUsd}` : "$1";
                },
              },
            ],
            description: "Marketplace service access pass",
            mimeType: "application/json",
          },
        };
        const marketHttpServer = new x402HTTPResourceServer(
          marketResourceServer,
          marketRoutes402,
        ).onProtectedRequest(async (ctx) => {
          // Passport mint: require a valid wallet signature + valid metadata
          // BEFORE payment — don't charge for requests that can't mint.
          if (ctx.path === "/api/market/passport") {
            const sig = await verifyWalletSigRequest({
              wallet: ctx.adapter.getHeader("x-wallet"),
              signature: ctx.adapter.getHeader("x-sig"),
              timestamp: ctx.adapter.getHeader("x-timestamp"),
              method: ctx.method,
              path: ctx.path,
            });
            if (sig !== "valid") {
              return {
                abort: true,
                reason: "valid X-Wallet/X-Sig/X-Timestamp required",
              };
            }
            const body = (await ctx.adapter.getBody?.()) as unknown;
            const v = validatePassportMeta(body);
            if (!v.ok) return { abort: true, reason: v.error };
          }
          // Buy: service must exist in the catalog before we accept payment.
          const buyMatch = /\/api\/market\/buy\/(0x[0-9a-fA-F]{64})/.exec(
            ctx.path,
          );
          if (buyMatch && !getMarketService(buyMatch[1])) {
            return { abort: true, reason: "unknown serviceId" };
          }
          return;
        });
        // SLICE-139-7: Arc self-settle path for AA/SCA buyers.
        // Runs BEFORE the x402 middleware — intercepts POST buy
        // requests carrying an Arc (eip155:5042002) payment
        // signature, verifies the broadcast tx on-chain, and mints
        // the pass to payer (= USDC Transfer.from = the SCA).
        // Requests without an Arc payment signature fall through to
        // the x402 middleware (Base exact rail / 402) unchanged.
        app.use("/api/market/buy/:serviceId", async (c, next) => {
          if (c.req.method !== "POST") return next();
          const psc = c.req.header("payment-signature");
          if (!psc) return next();
          let decoded: {
            accepted?: { network?: string };
            payload?: { txHash?: string };
          };
          try {
            decoded = JSON.parse(
              Buffer.from(psc, "base64").toString("utf8"),
            );
          } catch {
            return next();
          }
          if (decoded?.accepted?.network !== "eip155:5042002") {
            return next(); // Base rail → x402 middleware
          }

          const serviceId = c.req.param("serviceId").toLowerCase();
          const svc = getMarketService(serviceId);
          if (!svc) return c.json({ error: "unknown serviceId" }, 404);

          // Server-side requirements — never trust client amounts.
          const requirements = {
            scheme: "eip3009-client-broadcast",
            network: "eip155:5042002",
            asset: "0x3600000000000000000000000000000000000000",
            amount: String(Math.round(Number(svc.priceUsd) * 1e6)),
            payTo: marketplaceCfg.treasury,
            maxTimeoutSeconds: 345600,
          };
          const v = await arcSelfSettle.verify(decoded, requirements as never);
          if (!v.isValid) {
            return c.json({ error: v.invalidReason ?? "arc payment invalid" }, 402);
          }
          const r = await arcSelfSettle.settle(decoded, requirements as never);
          if (!r.success) {
            return c.json({ error: r.errorReason ?? "arc settle failed" }, 402);
          }

          const payer = r.payer as `0x${string}`;
          const ops = getMarketplaceOps();
          const durationSec = svc.durationSec ?? svc.durationDays * 86_400;
          // Arc payment went to treasury (no Base splitter split) —
          // skip creditPayment; mint the pass to payer (= SCA).
          let mintTx: string | undefined;
          try {
            mintTx = await ops.mintServicePass(
              payer,
              serviceId as `0x${string}`,
              durationSec,
              0n,
            );
            logger.info("marketplace-mint: arc pass minted", {
              payer, serviceId, mintTx, paymentTx: r.transaction,
            });
          } catch (err) {
            logger.error("marketplace-mint: arc mint failed", {
              payer, serviceId, err: String(err),
            });
          }
          return c.json({
            purchased: true,
            serviceId,
            service: svc.name,
            price: { amount: svc.priceUsd, currency: "USDC" },
            durationDays: svc.durationDays,
            payer,
            paymentTx: r.transaction,
            mintTx,
            note: "Service pass minted to the payer wallet on Arc Testnet (arc self-settle)",
          });
        });
        app.use(paymentMiddlewareFromHTTPServer(marketHttpServer));
        logger.info(
          "x402 middleware wired for marketplace (passport mint + service buy)",
        );
      } catch (e) {
        logger.error("Failed to wire marketplace x402 middleware", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Routes registered AFTER the x402 middleware — Hono runs
    // handlers in registration order, so the payment gate must
    // precede the route handlers or it never executes (139-3 fix).
    app.route("/api", marketplaceApiRoutes);
    app.route("/", marketplacePageRoutes); // SLICE-138-5: /market/* UI
  }
}
