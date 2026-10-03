// SLICE-156-2: buyer Gateway onboarding — deposit instructions.
// GET /api/pay/gateway/deposit-info  — per-chain gatewayWallet/usdc/
//   minDeposit + credit estimate (buyer "I have USDC on another chain").
// GET /api/pay/gateway/deposit-qr.svg?chain=<caip2|chainId>
//   — QR of ethereum:{gatewayWallet}@{chainId} transfer target.
// Read-only, no auth; data comes from chains.ts + cfg.gatewayMinDepositUsd.

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { toString as qrToString } from "qrcode";
import {
  ARC_MAINNET,
  ARC_TESTNET,
  BASE_SEPOLIA,
  gatewayDepositInfo,
  type SupportedChain,
} from "@agentbadge/circle-payments";
import type { CirclePaymentsConfig } from "../../config/env";
import type {
  CrosschainPaymentsStore,
  CrosschainPaymentState,
} from "../lib/crosschain-payments";
import type { PaymentStatusLookup } from "@agentbadge/circle-payments";

/** Router default: Base + Arc (mainnet flag swaps Arc testnet → mainnet). */
export function gatewayChainsFor(
  cfg: CirclePaymentsConfig,
): SupportedChain[] {
  return (
    cfg.gatewayChains ??
    [BASE_SEPOLIA, cfg.arcMainnet ? ARC_MAINNET : ARC_TESTNET]
  );
}

/** SLICE-156-5: optional deps enabling the buyer transfer-status route. */
export interface GatewayRouteDeps {
  store?: CrosschainPaymentsStore;
  statusLookup?: PaymentStatusLookup;
}

const TERMINAL: ReadonlySet<string> = new Set<CrosschainPaymentState>([
  "settled",
  "expired",
  "failed",
]);

export function createGatewayDepositRoutes(
  cfg: CirclePaymentsConfig,
  deps?: GatewayRouteDeps,
): Hono {
  const routes = new Hono();

  routes.get(
    "/api/pay/gateway/deposit-info",
    describeRoute({
      description:
        "Gateway deposit instructions — per-chain GatewayWallet + USDC " +
        "addresses, minimum deposit and credit-time estimate",
      responses: {
        200: {
          description:
            "{chains: [{chain,network,gatewayWallet,usdc,minDeposit," +
            "creditEstimateSec,transferUri,explorerUrl}],minDeposit,howto}",
        },
      },
    }),
    (c) =>
      c.json(
        gatewayDepositInfo(gatewayChainsFor(cfg), cfg.gatewayMinDepositUsd),
      ),
  );

  routes.get(
    "/api/pay/gateway/deposit-qr.svg",
    describeRoute({
      description:
        "QR code (SVG) of ethereum:{gatewayWallet}@{chainId} — transfer " +
        "USDC on the buyer's chain to fund Gateway unified balance",
      responses: {
        200: { description: "image/svg+xml" },
        400: { description: "Unknown or non-Gateway chain" },
      },
    }),
    async (c) => {
      const q = c.req.query("chain")?.trim();
      const chain = gatewayChainsFor(cfg).find(
        (ch) => ch.caip2 === q || String(ch.chainId) === q,
      );
      if (!chain?.gatewayWallet) {
        return c.json({ error: "unknown or non-Gateway chain" }, 400);
      }
      const svg = await qrToString(
        `ethereum:${chain.gatewayWallet}@${chain.chainId}`,
        { type: "svg", margin: 2 },
      );
      return c.body(svg, 200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      });
    },
  );

  // SLICE-156-5: buyer-facing transfer status — no auth (payer knows
  // their own transfer id). Local store first, Gateway API fallback.
  // Expired burn intents refund automatically on the source chain.
  routes.get(
    "/api/pay/gateway/transfers/:id",
    describeRoute({
      description:
        "Gateway transfer status — settling/settled/expired/failed; " +
        "expired burn intents refund the buyer automatically",
      responses: {
        200: {
          description:
            "{id,state,terminal,refund,sourceChain,scheme,amountUsd," +
            "settleTx?,expiresAt?} or upstream {id,status,ref}",
        },
        404: { description: "Unknown transfer" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const entry = deps?.store?.get(id);
      if (entry) {
        return c.json({
          id: entry.id,
          state: entry.state,
          terminal: TERMINAL.has(entry.state),
          refund:
            entry.state === "expired"
              ? "automatic-on-expiry"
              : null,
          sourceChain: entry.sourceChain,
          scheme: entry.scheme,
          amountUsd: entry.amountUsd,
          ...(entry.settleTx ? { settleTx: entry.settleTx } : {}),
          ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
        });
      }
      if (deps?.statusLookup) {
        try {
          const st = await deps.statusLookup(id);
          return c.json({ id, status: st.status, ref: st.ref });
        } catch {
          /* fall through to 404 */
        }
      }
      return c.json({ error: "unknown transfer" }, 404);
    },
  );

  return routes;
}
