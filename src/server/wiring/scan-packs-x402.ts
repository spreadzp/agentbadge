// EPIC-140 (SLICE-140-3): scan-packs x402 dynamic-pricing gate extracted from index.ts.
// MUST be called before app.route("/api", totalScanRoutes) — Hono composes
// handlers in registration order, so middleware added after the route never runs.
//
// SLICE-156-1: when the Circle payments runtime is available (CIRCLE_PAYMENTS_ENABLED)
// the POST /api/total-scan gate runs on it — multi-chain accepts[] (Gateway
// GatewayWalletBatched + exact + Arc self-settle), shared router, facilitator
// probe fallback. Without the runtime the legacy x402 stack stays in place
// (zero behavior change for envs that never enabled circle payments).

import type { Context, Hono } from "hono";
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
import {
  createMintOnSettleHook,
  createMintOnPaymentSettled,
  packsToClassMask,
  CLASS_FULL,
} from "../lib/access-pass-minter";
import { checkAccessPassRequest } from "../middleware/agent-auth";
import { scanPacksApiRoutes } from "../routes/scan-packs-api";
import type { CirclePaymentsRuntime } from "../lib/circle-payments";

// SLICE-136-1: canonical public URL for the resource field — behind Fly TLS
// termination adapter.getUrl() reports http://, which breaks Bazaar indexing.
const resourceUrl = () =>
  `${(process.env.BASE_URL ?? "https://agentbadge.xyz").replace(/\/$/, "")}/api/total-scan`;

/** Body read that never consumes the original request stream (the route
 *  handler still needs `c.req.json()` afterwards). */
async function readBody(c: Context): Promise<{ packs?: unknown } | undefined> {
  try {
    return (await c.req.raw.clone().json()) as { packs?: unknown } | undefined;
  } catch {
    return undefined;
  }
}

function resolvedPacks(body: { packs?: unknown } | undefined): string[] {
  const raw = Array.isArray(body?.packs) ? (body!.packs as string[]) : [];
  return resolveBundleIds(raw).ok;
}

/** Price resolver: sum of selected pack prices; none/invalid → full scan. */
async function scanPackPrice(c: Context): Promise<string> {
  const ok = resolvedPacks(await readBody(c));
  const amount = ok.length > 0 ? totalPrice(ok).amount : FULL_SCAN_PRICE;
  return `$${amount}`;
}

/** Access-pass class for the request — multi-class (or empty → full scan)
 *  requires a FULL pass; hasAccess ORs mask bits so a mixed mask would be
 *  too permissive. */
function requiredClass(body: { packs?: unknown } | undefined): number {
  const ok = resolvedPacks(body);
  const mask = packsToClassMask(ok.length ? ok : [...BUNDLE_IDS]);
  return mask === 0 || (mask & (mask - 1)) !== 0 ? CLASS_FULL : mask;
}

/** onBeforeChallenge adapter — same semantics as the legacy
 *  onProtectedRequest: no headers → payment flow; granted → bypass;
 *  invalid → abort response; no-pass → payment offer. */
async function accessPassChallenge(c: Context) {
  const wallet = c.req.header("x-wallet");
  const signature = c.req.header("x-sig");
  const timestamp = c.req.header("x-timestamp");
  if (!wallet && !signature && !timestamp) return undefined;
  const result = await checkAccessPassRequest({
    wallet,
    signature,
    timestamp,
    method: c.req.method,
    path: c.req.path,
    cls: requiredClass(await readBody(c)),
  });
  if (result === "granted") return true;
  if (result === "no-pass") return undefined;
  return c.json({ error: "invalid access-pass signature or headers" }, 403);
}

/** Pack catalog 402 body — same payload shape as the legacy
 *  unpaidResponseBody.body. */
async function packCatalogBody(c: Context) {
  const ok = resolvedPacks(await readBody(c));
  const catalog = bundleMetadata(
    AGENT_READINESS_RULESET.rules,
    ok.length ? ok : [...BUNDLE_IDS],
  );
  return {
    error: "Payment required",
    packs: catalog.bundles.map((b) => ({
      id: b.id,
      price: b.price,
      ruleCount: b.ruleCount,
    })),
    totalPrice:
      ok.length > 0 ? totalPrice(ok) : { amount: FULL_SCAN_PRICE, currency: USDC },
  };
}

/** D10: Bazaar discovery declaration — shared by both paths. */
const scanDiscoveryExtension = () =>
  declareDiscoveryExtension({
    bodyType: "json",
    input: { url: "https://example.com", packs: ["discovery-crawling"] },
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target site URL to scan" },
        packs: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional rule bundle ids (see GET /api/scan-packs); omit for full scan",
        },
      },
      required: ["url"],
    },
    output: {
      example: {
        event: "result",
        data: {
          score: 72,
          bundles: { "discovery-crawling": { passed: 15, failed: 4 } },
        },
      },
    },
  });

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
      extensions: scanDiscoveryExtension(),
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

/** SLICE-156-1: runtime path — multi-chain accepts via the shared router. */
function wireScanPacksOnRuntime(app: Hono, runtime: CirclePaymentsRuntime): void {
  const payTo = process.env.X402_PAY_TO ?? getConfig().circlePayments?.sellerAddress;
  if (!payTo) {
    logger.error("x402 scan-packs: no payTo (X402_PAY_TO / CIRCLE_SELLER_ADDRESS unset) — route unprotected");
    return;
  }
  app.use(
    "/api/total-scan",
    runtime.paymentForPrice(scanPackPrice, {
      payTo,
      methods: ["POST"],
      description: "AgentBadge agent-readiness scan — priced per selected rule bundle",
      mimeType: "text/event-stream",
      resourceUrl: () => resourceUrl(),
      extensions: scanDiscoveryExtension(),
      unpaidBody: packCatalogBody,
      onBeforeChallenge: accessPassChallenge,
      // EPIC-137: mint/extend the payer's AccessPassNFT on Arc after settle.
      onSettleResult: createMintOnPaymentSettled(),
    }) as never,
  );
  logger.info(
    "x402 middleware wired for POST /api/total-scan via circle-payments runtime (multi-chain accepts)",
  );
}

export function wireScanPacksX402(
  app: Hono,
  deps: { runtime?: CirclePaymentsRuntime } = {},
): void {
  // EPIC-133: bundle catalog endpoint — gated by scanPacks.enabled (D4)
  const scanPacksCfg = getConfig().scanPacks;
  if (scanPacksCfg.enabled) {
    app.route("/api", scanPacksApiRoutes);
  }
  // SLICE-133-16: x402 dynamic pricing on pack scans — gated by
  // scanPacks.enabled + scanPacks.pricingEnabled. Price is computed per
  // request from body.packs via totalPrice(); no packs → FULL_SCAN_PRICE.
  // MUST be registered before totalScanRoutes (Hono composes in order).
  if (!(scanPacksCfg.enabled && scanPacksCfg.pricingEnabled)) return;

  if (deps.runtime) {
    try {
      wireScanPacksOnRuntime(app, deps.runtime);
      return;
    } catch (e) {
      logger.error("x402 runtime wiring failed — falling back to legacy stack", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    // Legacy path (pre-156): single-chain exact on Base Sepolia via the
    // x402.org facilitator stack. EVM treasury: X402_PAY_TO overrides the
    // Hedera-scoped x402Treasury (0.0.x account id).
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
    logger.info("x402 middleware wired for POST /api/total-scan (legacy stack — scan packs pricing + access pass)");
  } catch (e) {
    logger.error("Failed to wire x402 middleware — total-scan unprotected", { error: e instanceof Error ? e.message : String(e) });
  }
}
