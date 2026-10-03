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

/** Router default: Base + Arc (mainnet flag swaps Arc testnet → mainnet). */
export function gatewayChainsFor(
  cfg: CirclePaymentsConfig,
): SupportedChain[] {
  return (
    cfg.gatewayChains ??
    [BASE_SEPOLIA, cfg.arcMainnet ? ARC_MAINNET : ARC_TESTNET]
  );
}

export function createGatewayDepositRoutes(
  cfg: CirclePaymentsConfig,
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

  return routes;
}
