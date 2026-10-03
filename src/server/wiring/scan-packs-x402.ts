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
import { declareDiscoveryExtension } from "@x402/extensions";
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
  createMintOnPaymentSettled,
  packsToClassMask,
  CLASS_FULL,
} from "../lib/access-pass-minter";
import { checkAccessPassRequest } from "../middleware/agent-auth";
import { scanPacksApiRoutes } from "../routes/scan-packs-api";
import type { CirclePaymentsRuntime, PaymentForOpts } from "../lib/circle-payments";

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

// SLICE-157-2 (1A): legacy x402.org stack removed — paid routes exist only
// on the circle-payments runtime. This exported opts-builder is the single
// source of the route's payment contract (tests reuse it, replacing the old
// buildTotalScanRouteConfig route-map).
export function buildTotalScanPaymentOpts(payTo: string): PaymentForOpts {
  return {
    payTo,
    methods: ["POST"],
    description: "AgentBadge agent-readiness scan — priced per selected rule bundle",
    mimeType: "text/event-stream",
    // SLICE-136-1: canonical public URL (Fly TLS termination reports http).
    resourceUrl: () => resourceUrl(),
    // D10: Bazaar discovery declaration — same shape as the legacy stack.
    extensions: scanDiscoveryExtension(),
    // 157-1: legacy advertised extra.paymentFlow=upfront on every accepts entry.
    extraRequirements: { paymentFlow: "upfront" },
    unpaidBody: packCatalogBody,
    // Access-pass holders skip payment (was legacy onProtectedRequest).
    onBeforeChallenge: accessPassChallenge,
    // EPIC-137: mint/extend the payer's AccessPassNFT on Arc after settle.
    onSettleResult: createMintOnPaymentSettled(),
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
    runtime.paymentForPrice(
      scanPackPrice,
      buildTotalScanPaymentOpts(payTo),
    ) as never,
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

  // SLICE-157-2 (1A): dual-mode ended — runtime-only. No legacy fallback.
  if (!deps.runtime) {
    logger.warn(
      "x402 scan-packs: circle-payments runtime unavailable — POST /api/total-scan unprotected",
    );
    return;
  }
  wireScanPacksOnRuntime(app, deps.runtime);
}
