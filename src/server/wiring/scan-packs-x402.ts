// EPIC-140 (SLICE-140-3): scan-packs x402 dynamic-pricing gate extracted from index.ts.
// MUST be called before app.route("/api", totalScanRoutes) — Hono composes
// handlers in registration order, so middleware added after the route never runs.

import type { Hono } from "hono";
import { paymentMiddlewareFromHTTPServer, x402ResourceServer, x402HTTPResourceServer, type SchemeNetworkServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension, withBazaar } from "@x402/extensions";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import {
  BUNDLE_IDS,
  FULL_SCAN_PRICE,
  USDC,
  bundleMetadata,
  resolveBundleIds,
  totalPrice,
} from "../../agent-readiness/rule-bundles";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";
import { createMintOnSettleHook, packsToClassMask, CLASS_FULL } from "../lib/access-pass-minter";
import { checkAccessPassRequest } from "../middleware/agent-auth";
import { scanPacksApiRoutes } from "../routes/scan-packs-api";

// SLICE-136-1: canonical public URL for the resource field — behind Fly TLS
// termination adapter.getUrl() reports http://, which breaks Bazaar indexing.
const resourceUrl = () =>
  `${(process.env.BASE_URL ?? "https://agentbadge.xyz").replace(/\/$/, "")}/api/total-scan`;

// SLICE-136-1: route config extracted for testability (tests reuse this
// builder instead of duplicating the pricing/extension logic inline).
export function buildTotalScanRouteConfig(payTo: string) {
  return {
    "POST /api/total-scan": {
      accepts: [{
        scheme: "exact",
        network: "eip155:84532" as const,
        payTo,
        price: async (ctx: { adapter: { getBody?: () => unknown } }) => {
          const body = (await ctx.adapter.getBody?.()) as { packs?: unknown } | undefined;
          const raw = Array.isArray(body?.packs) ? (body.packs as string[]) : [];
          const { ok } = resolveBundleIds(raw);
          const amount = ok.length > 0 ? totalPrice(ok).amount : FULL_SCAN_PRICE;
          return `$${amount}`;
        },
        extra: { paymentFlow: "upfront" },
      }],
      resource: resourceUrl(),
      description: "AgentBadge agent-readiness scan — priced per selected rule bundle",
      mimeType: "text/event-stream",
      // D10: declare Bazaar discovery extension as designed (input schema +
      // output example) — bazaar-extension middleware stays as fallback.
      extensions: declareDiscoveryExtension({
        bodyType: "json",
        input: { url: "https://example.com", packs: ["discovery-crawling"] },
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Target site URL to scan" },
            packs: {
              type: "array",
              items: { type: "string" },
              description: "Optional rule bundle ids (see GET /api/scan-packs); omit for full scan",
            },
          },
          required: ["url"],
        },
        output: {
          example: {
            event: "result",
            data: { score: 72, bundles: { "discovery-crawling": { passed: 15, failed: 4 } } },
          },
        },
      }),
      unpaidResponseBody: async (ctx: { adapter: { getBody?: () => unknown } }) => {
        const body = (await ctx.adapter.getBody?.()) as { packs?: unknown } | undefined;
        const raw = Array.isArray(body?.packs) ? (body.packs as string[]) : [];
        const { ok } = resolveBundleIds(raw);
        const catalog = bundleMetadata(AGENT_READINESS_RULESET.rules, ok.length ? ok : [...BUNDLE_IDS]);
        return {
          contentType: "application/json",
          body: {
            error: "Payment required",
            packs: catalog.bundles.map((b) => ({ id: b.id, price: b.price, ruleCount: b.ruleCount })),
            totalPrice: ok.length > 0 ? totalPrice(ok) : { amount: FULL_SCAN_PRICE, currency: USDC },
          },
        };
      },
    },
  };
}

export function wireScanPacksX402(app: Hono): void {
  // EPIC-133: bundle catalog endpoint — gated by scanPacks.enabled (D4)
  const scanPacksCfg = getConfig().scanPacks;
  if (scanPacksCfg.enabled) {
    app.route("/api", scanPacksApiRoutes);
  }
  // SLICE-133-16: x402 dynamic pricing on pack scans — gated by
  // scanPacks.enabled + scanPacks.pricingEnabled. Price is computed per
  // request from body.packs via totalPrice(); no packs → FULL_SCAN_PRICE.
  // MUST be registered before totalScanRoutes (Hono composes in order).
  if (scanPacksCfg.enabled && scanPacksCfg.pricingEnabled) {
    try {
      // EVM scheme on Base Sepolia → EVM facilitator + EVM treasury.
      // (x402FacilitatorUrl/x402Treasury are Hedera-scoped: blocky402 + 0.0.x account id.)
      // SLICE-136-2: withBazaar adds discovery query methods (listResources/
      // search) to the facilitator client — reference Bazaar setup (x402#2112).
      const facilitatorClient = withBazaar(new HTTPFacilitatorClient({
        url: process.env.X402_FACILITATOR_URL ?? getConfig().x402FacilitatorUrl,
      }));
      const resourceServer = new x402ResourceServer(facilitatorClient)
        .register("eip155:84532", new ExactEvmScheme() as unknown as SchemeNetworkServer)
        // SLICE-136-2: enrichDeclaration hook — injects method into bazaar
        // schema + routeTemplate/pathParams for dynamic routes (x402#2112).
        .registerExtension(bazaarResourceServerExtension)
        // EPIC-137: mint/extend the payer's AccessPassNFT on Arc after settle.
        .onAfterSettle(createMintOnSettleHook());
      const payTo = process.env.X402_PAY_TO ?? getConfig().x402Treasury;
      const totalScanRoutes402 = buildTotalScanRouteConfig(payTo);
      const httpServer = new x402HTTPResourceServer(resourceServer, totalScanRoutes402)
        // EPIC-137: access-pass holders skip payment — signed challenge + valid pass on Arc.
        .onProtectedRequest(async (ctx) => {
          const wallet = ctx.adapter.getHeader("x-wallet");
          const signature = ctx.adapter.getHeader("x-sig");
          const timestamp = ctx.adapter.getHeader("x-timestamp");
          if (!wallet && !signature && !timestamp) return; // → x402 payment flow
          const body = (await ctx.adapter.getBody?.()) as { packs?: unknown } | undefined;
          const raw = Array.isArray(body?.packs) ? (body.packs as string[]) : [];
          const { ok } = resolveBundleIds(raw);
          const mask = packsToClassMask(ok.length ? ok : [...BUNDLE_IDS]);
          // Multi-class request (or empty → full scan) requires a FULL pass —
          // hasAccess ORs mask bits, so a mixed mask would be too permissive.
          const cls = mask === 0 || (mask & (mask - 1)) !== 0 ? CLASS_FULL : mask;
          const result = await checkAccessPassRequest({
            wallet,
            signature,
            timestamp,
            method: ctx.method,
            path: ctx.path,
            cls,
          });
          if (result === "granted") return { grantAccess: true };
          if (result === "no-pass") return; // valid sig, no pass → 402 payment offer
          return { abort: true, reason: "invalid access-pass signature or headers" };
        });
      app.use(paymentMiddlewareFromHTTPServer(httpServer));
      logger.info("x402 middleware wired for POST /api/total-scan (scan packs pricing + access pass)");
    } catch (e) {
      logger.error("Failed to wire x402 middleware — total-scan unprotected", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}
