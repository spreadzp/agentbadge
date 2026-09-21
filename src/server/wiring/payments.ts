// EPIC-140 (SLICE-140-2): payment middleware wiring extracted from index.ts.
//
// Two call-sites, NOT one continuous block — middleware order is security-relevant:
//   wireL402(app)        — called where the L402 block used to sit (before
//                          signatureVerification / rateLimit / bazaar / ga4).
//   wirePaymentGates(app) — called after notFound + config validation, before
//                          route mounts (x402 Hedera + MPP/Stripe + Base x402).
// Merging them into a single call would move x402/MPP/Base above
// signature+rateLimit and change request handling (see decisions.md D10).

import type { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HEDERA_TESTNET_CAIP2 } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { getPrice, logger } from "@agentbadge/passport";
import { l402PaymentMiddleware } from "../middleware/l402";
import { mppPaymentMiddleware } from "../middleware/mpp";
import { baseX402PaymentMiddleware } from "../middleware/x402-base";

// SLICE-49-19: L402 Lightning payment middleware (before signature verification)
// Payment challenge must be returned before signature check — client pays first, then signs.
// Test mode generates mock macaroons + test invoices and accepts any preimage.
// In production, set L402_LND_URL and L402_LND_MACAROON for real Lightning invoices.
export function wireL402(app: Hono): void {
  const l402AmountSats = Number(process.env.L402_AMOUNT_SATS ?? "100");
  app.use(
    "/passport/request",
    l402PaymentMiddleware({
      amountSats: l402AmountSats,
      memo: "AgentBadge Passport NFT issuance",
      rootKey: process.env.L402_ROOT_KEY,
      lndUrl: process.env.L402_LND_URL,
      lndMacaroon: process.env.L402_LND_MACAROON,
    }),
  );
}

// x402 Hedera + MPP/Stripe + Base x402 payment gates for POST /passport/request.
// Each gate is env-gated: with no env configured nothing is registered.
export function wirePaymentGates(app: Hono): void {
  const facilitatorUrl = process.env.x402_FACILITATOR_URL ?? "";
  const payTo = process.env.x402_TREASURY ?? process.env.HEDERA_OPERATOR_ID ?? "";
  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const networkId = network === "mainnet" ? "hedera:mainnet" : HEDERA_TESTNET_CAIP2;

  if (facilitatorUrl && payTo) {
    const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
    const resourceServer = new x402ResourceServer(facilitatorClient).register(
      networkId,
      new ExactHederaScheme(),
    );

    app.use(
      paymentMiddleware(
        {
          "POST /passport/request": {
            accepts: {
              scheme: "exact",
              price: (ctx) => {
                const body = ctx.adapter.getBody?.() as Record<string, unknown> | undefined;
                const tier = (body?.tier as string) ?? "bronze";
                const tinybars = getPrice(tier);
                return { amount: String(tinybars), asset: "0.0.0" };
              },
              network: networkId,
              payTo,
              extra: {
                asset: "0.0.0",
                feePayer: process.env.x402_FEE_PAYER ?? payTo,
              },
            },
            description: "Agent Passport NFT issuance",
            mimeType: "application/json",
          },
        },
        resourceServer,
      ),
    );
  }

  const mppSecretKey = process.env.MPP_SECRET_KEY ?? "";
  const mppRecipient = process.env.MPP_RECIPIENT_ADDRESS ?? payTo;
  const mppAmount = process.env.MPP_AMOUNT ?? "0.01";
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";

  if (mppSecretKey || mppRecipient) {
    app.use(
      "/passport/request",
      mppPaymentMiddleware({
        secretKey: mppSecretKey,
        recipientAddress: mppRecipient,
        amount: mppAmount,
        stripeSecretKey,
      }),
    );
  }

  // SLICE-90-9: x402 Base Sepolia payment middleware (active when CHAIN_MODE=base)
  // SLICE-90-11: Start event indexer when CHAIN_MODE=base
  const chainMode = process.env.CHAIN_MODE ?? "hedera";

  if (chainMode === "base") {
    import("../lib/base-event-indexer").then(({ startBaseEventIndexer }) => {
      startBaseEventIndexer();
    }).catch((e) => {
      console.warn("[Server] Failed to start base event indexer:", e);
    });
  }
  const baseX402FacilitatorUrl = process.env.X402_FACILITATOR_URL ?? "";
  const baseUsdcAddress = process.env.BASE_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseTreasury = process.env.BASE_TREASURY ?? "";
  const baseX402Price = process.env.X402_BASE_PRICE ?? "1000000"; // 1 USDC

  if (chainMode === "base" && baseX402FacilitatorUrl && baseTreasury) {
    app.use(
      "/passport/request",
      baseX402PaymentMiddleware({
        facilitatorUrl: baseX402FacilitatorUrl,
        payTo: baseTreasury,
        usdcAddress: baseUsdcAddress,
        networkId: "eip155:84532",
        price: baseX402Price,
        description: "Agent Passport NFT issuance (Base Sepolia)",
        mimeType: "application/json",
      }),
    );
    logger.info("x402 Base Sepolia payment middleware active", {
      facilitator: baseX402FacilitatorUrl,
      usdc: baseUsdcAddress,
    });
  }
}
