import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { openAPIRouteHandler } from "hono-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { stringify as yamlStringify } from "yaml";
import { getConfig } from "../config/env";
import { paymentMiddleware, paymentMiddlewareFromHTTPServer, x402ResourceServer, x402HTTPResourceServer, type SchemeNetworkServer } from "@x402/hono";
import { HEDERA_TESTNET_CAIP2 } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

import { getPrice, logger } from "@agentbadge/passport";
import { getNftsForAccount } from "@agentbadge/hedera-core";
import { signatureVerificationMiddleware } from "./middleware/signature-verification";
import { adminAuth } from "./middleware/adminAuth";
import { mppPaymentMiddleware } from "./middleware/mpp";
import { l402PaymentMiddleware } from "./middleware/l402";
import { bazaarExtensionMiddleware } from "./middleware/bazaar-extension";
import {
  startBackgroundRebuild,
  a2aStartBackgroundRebuild as startA2ACacheRebuild,
  marketStartBackgroundRebuild as startMarketCacheRebuild,
} from "@agentbadge/passport";
import {
  registerPassportTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerGuideTools,
  registerSigningTools,
  registerDiscoveryTools,
  registerEscrowTools,
  registerDatasetTools,
  registerAllTools,
  listTools,
  createNamespace,
} from "@agentbadge/mcp";
import { registerComplianceTools } from "../mcp/compliance-tools";
import { registerParityTools } from "../mcp/parity-tools";
import { registerKeeperhubTools } from "../mcp/keeperhub-tools";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestLoggerMiddleware } from "./middleware/request-logger";
import { corsMiddleware } from "./middleware/cors";
import { contentNegotiationMiddleware } from "./middleware/content-negotiation";
import { cacheHeadersMiddleware } from "./middleware/cache-headers";
import { hostNormalizationMiddleware, trailingSlashMiddleware } from "./middleware/canonical-redirects";
import { structuredNotFoundHandler } from "./middleware/structured-error-handler";
import { securityHeaders } from "./middleware/security-headers";
import { ga4Pageview } from "./middleware/ga4-pageview";
import { openApiConfig } from "./openapi";
import { passportRoutes } from "./routes/passport";
import { mcpRoutes } from "./routes/mcp";
import { createNamespaceRoutes } from "./routes/mcp-namespace";
import { agentRoutes } from "./routes/agents";
import { verifyRoutes } from "./routes/verify";
import { didRoutes } from "./routes/did";
import { adminRoutes } from "./routes/admin";
import { upgradeRoutes } from "./routes/upgrade";
import { auditRoutes } from "./routes/audit";
import { eventsRoutes } from "./routes/events";
import { catalogRoutes } from "./routes/catalog";
import { uiRoutes } from "./routes/ui";
import { landingRoutes } from "./routes/landing";
import { authorityRoutes } from "./routes/authority";
import { hackathonRoutes } from "./routes/hackathon";
import { servicesRoutes } from "./routes/services";
import { agentGuideRoutes } from "./routes/agent-guide";
import { agentKnowledgeRoutes } from "./routes/agent-knowledge";
import { teamRoutes } from "./routes/agent-guide/team";
import { a2aRoutes } from "./routes/a2a";
import { linkedinRoutes } from "./routes/linkedin";
import { marketRoutes } from "./routes/market";
import { metaRoutes } from "./routes/meta";
import { searchRoutes } from "./routes/search";
import { marketGuideRoutes } from "./routes/market-guide";
import { medicalGuideRoutes } from "./routes/medical-guide";
import { contactRoutes } from "./routes/contact";
import { contentPageRoutes } from "./routes/content-pages";
import { blogRoutes } from "./routes/blog";
import { rulesApiRoutes } from "./routes/rules-api";
import { scanRuleRoutes } from "./routes/scan-rule-api";
import { scanPacksApiRoutes } from "./routes/scan-packs-api";
import {
  BUNDLE_IDS,
  FULL_SCAN_PRICE,
  USDC,
  bundleMetadata,
  resolveBundleIds,
  totalPrice,
} from "../agent-readiness/rule-bundles";
import { AGENT_READINESS_RULESET } from "../agent-readiness/ruleset";
import { totalScanRoutes } from "./routes/total-scan-api";
import { benchmarkRoutes } from "./routes/benchmark-api";
import { benchmarkPageRoutes } from "./routes/benchmark-pages";
import { teamPageRoutes } from "./routes/team-pages";
import { workRequestRoutes } from "./routes/api/work-requests";
import { workRequestUiRoutes } from "./routes/work-request-ui";
import { demandRoutes } from "./routes/api/demand";
import { demandGuideRoutes } from "./routes/agent-guide/demand";
import { changelogRoutes } from "./routes/changelog";
import { agencyJsonRoutes } from "./routes/agency-json";
import { profileRoutes } from "./routes/profile";
import { profileViewerRoutes } from "./routes/profile-viewer";
import { webmcpApiRoutes } from "./routes/webmcp-api";
import { keeperhubApiRoutes } from "./routes/keeperhub-api";
import { linkGraphRoutes } from "./routes/link-graph-api";
import { wellKnownRoutes } from "./routes/well-known";
import { agentCardRoutes } from "./routes/agent-card";
import { feedRoutes } from "./routes/feed";
import { trustRoutes } from "./routes/trust";
import { trustViewerRoutes } from "./routes/trust-viewer";
import { metricsApp } from "./routes/metrics";
import { telemetryApp } from "./routes/telemetry";
import { paymentRoutes } from "./routes/payment";
import { createMonitoringRoutes } from "./routes/monitoring";
import { createMonitoringStore } from "../agent-readiness/monitoring/monitoring-store";
import { createCirclePaymentsRuntime } from "./lib/circle-payments";
import { createMintOnSettleHook, packsToClassMask, CLASS_FULL } from "./lib/access-pass-minter";
import { checkAccessPassRequest, verifyWalletSigRequest } from "./middleware/agent-auth";
import { marketplaceApiRoutes } from "./routes/marketplace-api";
import { marketplacePageRoutes } from "./routes/marketplace-pages";
import {
  createMarketplaceMintOnSettleHook,
  getService as getMarketService,
  validatePassportMeta,
} from "./lib/marketplace";
import { createIdentityRoutes } from "./routes/identity";
import { createDemoRoutes } from "./routes/demo";
import {
  registerCirclePayTools,
  setCirclePayToolConfig,
} from "../mcp/circle-pay-tools";
import {
  registerPaymentStatusTools,
  setPaymentStatusToolConfig,
} from "../mcp/payment-status-tools";
import {
  registerAgentIdentityTools,
  setAgentIdentityToolConfig,
} from "../mcp/agent-identity-tools";
import {
  registerCircleWalletBalanceTools,
  setCircleWalletBalanceToolConfig,
} from "../mcp/circle-wallet-balance-tools";
import {
  registerSupportedNetworksTools,
  setSupportedNetworksToolConfig,
} from "../mcp/supported-networks-tools";
import {
  registerPaymentHistoryTools,
  setPaymentHistoryToolConfig,
} from "../mcp/payment-history-tools";
import { isStripeConfigured } from "./lib/stripe-client";
import { loadConfig } from "../config/env";
import { attestcoinRoutes, setAttestcoinRouteConfig } from "./routes/attestcoin";
import { initSentry, captureError } from "./lib/sentry";
import { ErrorCodes } from "./lib/error-codes";
import { errorResponse } from "./lib/error-response";
import { VerifierRegistry, NoopVerifier, DataHubVerifier } from "../verifiers";
import { baseX402PaymentMiddleware } from "./middleware/x402-base";
import { APP_VERSION, BUILD_DATE, GIT_COMMIT } from "./lib/build-info";

// Initialize Sentry before anything else (no-op if SENTRY_DSN not set)
initSentry();

// Register verifiers (SLICE-24-4, SLICE-24-5)
const verifierRegistry = VerifierRegistry.getInstance();
verifierRegistry.register(new NoopVerifier());

if (process.env.DATAHUB_ENABLED === "true") {
  verifierRegistry.register(new DataHubVerifier());
  logger.info("DataHub verifier registered", { url: process.env.DATAHUB_MCP_URL });
}

const app = new Hono();

// SLICE-81-1: Host + path normalization (www→apex 301, trailing-slash 301, fly.dev exact-match)
// SLICE-131-1: extracted to middleware/canonical-redirects.ts — forces https behind proxy
app.use(hostNormalizationMiddleware());
app.use(trailingSlashMiddleware());

app.use(requestLoggerMiddleware());
app.use(corsMiddleware());
app.use(securityHeaders());
app.use(contentNegotiationMiddleware());
app.use(cacheHeadersMiddleware());
// SLICE-49-19: L402 Lightning payment middleware (before signature verification)
// Payment challenge must be returned before signature check — client pays first, then signs.
// Test mode generates mock macaroons + test invoices and accepts any preimage.
// In production, set L402_LND_URL and L402_LND_MACAROON for real Lightning invoices.
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
app.use((c, next) => signatureVerificationMiddleware(c as unknown as Parameters<typeof signatureVerificationMiddleware>[0], next));
app.use(rateLimitMiddleware());
app.use(bazaarExtensionMiddleware());

// SLICE-130-7: GA4 pageview tracking — fire-and-forget for HTML 200 GET responses
app.use(ga4Pageview);

// Structured 404 handler — JSON for API clients, HTML for browsers
app.notFound(structuredNotFoundHandler());

const isMockMode = process.env.MOCK_HEDERA === "true";
if (!isMockMode) {
  try {
    loadConfig();
    logger.info("Environment configuration validated");
  } catch (e) {
    logger.error("SERVER: Config error", { error: e });
    process.exit(1);
  }
}

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
  import("./lib/base-event-indexer").then(({ startBaseEventIndexer }) => {
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

app.route("/", linkedinRoutes);

app.get("/health", (c) => {
  const tools = listTools();
  return c.json({
    status: "healthy",
    version: APP_VERSION,
    buildDate: BUILD_DATE,
    gitCommit: GIT_COMMIT,
    uptime: process.uptime(),
    mcp: {
      toolsCount: tools.length,
      tools: tools.map((t) => t.name),
    },
    payments: {
      stripe: isStripeConfigured() ? "configured" : "not_configured",
    },
    timestamp: Date.now(),
  });
});

// SLICE-121-2: API alias routes — mirror root endpoints under /api/ for AI-agent convention
app.get("/api/health", (c) => {
  const tools = listTools();
  return c.json({
    status: "healthy",
    version: APP_VERSION,
    buildDate: BUILD_DATE,
    gitCommit: GIT_COMMIT,
    uptime: process.uptime(),
    mcp: {
      toolsCount: tools.length,
      tools: tools.map((t) => t.name),
    },
    payments: {
      stripe: isStripeConfigured() ? "configured" : "not_configured",
    },
    timestamp: Date.now(),
  });
});
app.get("/api/catalog", (c) => c.redirect("/catalog", 301));
app.get("/api/audit/:tokenId?/:serial?", (c) => {
  const tokenId = c.req.param("tokenId");
  const serial = c.req.param("serial");
  const path = serial ? `/audit/${tokenId}/${serial}` : tokenId ? `/audit/${tokenId}` : "/audit";
  return c.redirect(path, 301);
});
app.all("/api/passport/request", (c) => c.redirect("/passport/request", 301));
// SLICE-131-2: /market landing moved to /services/marketplace (GSC BUG-2)
app.get("/market", (c) => c.redirect("/services/marketplace", 301));

// Serve static files from public/ (favicon, icons, logo, CSS, Google verification)
app.use("/favicon.ico", (c, next) => {
  c.header("Cache-Control", "public, max-age=86400");
  return next();
}, serveStatic({ root: "./public", path: "/favicon.ico" }));
app.use("/favicon.svg", (c, next) => {
  c.header("Cache-Control", "public, max-age=86400");
  c.header("Content-Type", "image/svg+xml");
  return next();
}, serveStatic({ root: "./public", path: "/favicon.svg" }));
app.use("/google23c66f9606672661.html", serveStatic({ root: "./public", path: "/google23c66f9606672661.html" }));
app.use("/manifest.json", (c) => {
  c.header("Cache-Control", "public, max-age=86400");
  return serveStatic({ root: "./public", path: "/manifest.json" })(c, () => Promise.resolve());
});
app.use("/.well-known/security.txt", (c) => {
  c.header("Cache-Control", "public, max-age=86400");
  return serveStatic({ root: "./public", path: "/.well-known/security.txt" })(c, () => Promise.resolve());
});
app.use("/6abf90e7f0354fb09ac01108f46a17e7.txt", serveStatic({ root: "./public", path: "/6abf90e7f0354fb09ac01108f46a17e7.txt" }));

const INDEXNOW_KEY = "6abf90e7f0354fb09ac01108f46a17e7";
const INDEXNOW_BASE = "https://agentbadge.xyz";
const INDEXNOW_ALLOWED_HOSTS = (process.env.INDEXNOW_ALLOWED_HOSTS ?? "agentbadge.xyz").split(",");
const INDEXNOW_MAX_URLS = 10;

app.post("/api/indexnow", adminAuth, async (c) => {
  try {
    const body = await c.req.json<{ urls?: string[] }>();
    const urls = body.urls ?? [`${INDEXNOW_BASE}/`];

    if (urls.length > INDEXNOW_MAX_URLS) {
      return c.json({ error: `Too many URLs (max ${INDEXNOW_MAX_URLS})` }, 400);
    }

    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (!INDEXNOW_ALLOWED_HOSTS.includes(parsed.hostname)) {
          return c.json({ error: `URL not allowed: ${u}` }, 403);
        }
      } catch {
        return c.json({ error: `Invalid URL: ${u}` }, 400);
      }
    }

    const payload = {
      host: "agentbadge.xyz",
      key: INDEXNOW_KEY,
      keyLocation: `${INDEXNOW_BASE}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    };
    const resp = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });

    logger.info("IndexNow submitted", { urlCount: urls.length });

    return c.json({ ok: resp.ok, status: resp.status, urls: urls.length });
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500);
  }
});
app.use("/icons/*", (c, next) => {
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return next();
}, serveStatic({ root: "./public" }));
app.use("/css/*", (c, next) => {
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return next();
}, serveStatic({ root: "./public" }));
app.use("/images/*", (c, next) => {
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return next();
}, serveStatic({ root: "./public" }));
app.use("/js/*", (c, next) => {
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  return next();
}, serveStatic({ root: "./public" }));

app.route("/", passportRoutes);
app.route("/", verifyRoutes);
app.route("/", didRoutes);
app.route("/", agentRoutes);
app.route("/", adminRoutes);
app.route("/", upgradeRoutes);
app.route("/", auditRoutes);
app.route("/", eventsRoutes);
app.route("/", catalogRoutes);
app.route("/", wellKnownRoutes);
app.route("/", agentCardRoutes);
app.route("/", feedRoutes);
app.route("/", mcpRoutes);

// Register MCP namespace tools BEFORE mounting namespace routes
// (createNamespaceRoutes calls getNamespace at mount time)
const passportNs = createNamespace("passport");
registerPassportTools(passportNs);
registerSigningTools(passportNs);
registerEscrowTools(passportNs);

const marketNs = createNamespace("market");
registerMarketplaceTools(marketNs);
registerDatasetTools(marketNs);

const discoveryNs = createNamespace("discovery");
registerDiscoveryTools(discoveryNs);
registerDirectoryTools(discoveryNs);
registerGuideTools(discoveryNs);
registerA2ATools(discoveryNs);

const auditNs = createNamespace("audit");
registerAuditCatalogTools(auditNs);
registerComplianceTools(auditNs);
registerParityTools(auditNs);

// Namespace MCP routes — each serves only its namespace's tools
app.route("/mcp/passport", createNamespaceRoutes("passport"));
app.route("/mcp/market", createNamespaceRoutes("market"));
app.route("/mcp/discovery", createNamespaceRoutes("discovery"));
app.route("/mcp/audit", createNamespaceRoutes("audit"));
app.route("/", landingRoutes);
app.route("/", authorityRoutes);
app.route("/", hackathonRoutes);
app.route("/", servicesRoutes);
app.route("/", uiRoutes);
app.route("/", agentGuideRoutes);
app.route("/", agentKnowledgeRoutes);
app.route("/", trustRoutes);
app.route("/", trustViewerRoutes);
app.route("/", teamRoutes);
app.route("/", a2aRoutes);
app.route("/", marketRoutes);
app.route("/", metaRoutes);
app.route("/", searchRoutes);
app.route("/", marketGuideRoutes);
app.route("/", medicalGuideRoutes);
app.route("/", contactRoutes);
app.route("/", contentPageRoutes);
app.route("/", blogRoutes);
app.route("/api", webmcpApiRoutes);

// x402 premium payment middleware — MUST be registered before keeperhubApiRoutes:
// Hono composes handlers in registration order, so middleware added after the route never runs.
const khCfg = getConfig().keeperhub;
if (khCfg?.enabled && khCfg.x402?.enabled) {
  const x402Cfg = khCfg.x402;
  try {
    const facilitatorClient = new HTTPFacilitatorClient({ url: x402Cfg.facilitatorUrl });
    // Cast: @x402/evm bundles its own @x402/core — getAssetDecimals return type differs structurally
    const resourceServer = new x402ResourceServer(facilitatorClient).register("eip155:84532", new ExactEvmScheme() as unknown as SchemeNetworkServer);
    app.use(paymentMiddleware({
      "POST /api/keeperhub/scan/premium": {
        accepts: [{ scheme: "exact", price: x402Cfg.price, network: "eip155:84532", payTo: x402Cfg.payTo, extra: { paymentFlow: "upfront" } }],
        description: "AgentBadge onchain scan recording — executed through KeeperHub, recorded on TrustRegistry (Base Sepolia)",
        mimeType: "application/json",
      },
    }, resourceServer));
    logger.info("x402 premium middleware wired for POST /api/keeperhub/scan/premium");
  } catch (e) {
    logger.error("Failed to wire x402 middleware — premium route unprotected", { error: e instanceof Error ? e.message : String(e) });
  }
}
app.route("/api", keeperhubApiRoutes);
app.route("/api", linkGraphRoutes);
app.route("/api", rulesApiRoutes);
app.route("/api", scanRuleRoutes);
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
    const facilitatorClient = new HTTPFacilitatorClient({
      url: process.env.X402_FACILITATOR_URL ?? getConfig().x402FacilitatorUrl,
    });
    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register("eip155:84532", new ExactEvmScheme() as unknown as SchemeNetworkServer)
      // EPIC-137: mint/extend the payer's AccessPassNFT on Arc after settle.
      .onAfterSettle(createMintOnSettleHook());
    const payTo = process.env.X402_PAY_TO ?? getConfig().x402Treasury;
    const totalScanRoutes402 = {
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
        description: "AgentBadge agent-readiness scan — priced per selected rule bundle",
        mimeType: "text/event-stream",
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
app.route("/api", totalScanRoutes);
app.route("/", benchmarkRoutes);
app.route("/", benchmarkPageRoutes);
app.route("/", teamPageRoutes);
app.route("/", workRequestRoutes);
app.route("/", workRequestUiRoutes);
app.route("/", demandRoutes);
app.route("/", demandGuideRoutes);
app.route("/", changelogRoutes);
app.route("/", agencyJsonRoutes);
app.route("/", profileRoutes);
app.route("/", profileViewerRoutes);

// Attestcoin routes (EPIC-127) — only when ATTESTCOIN_ENABLED=true
const attestcoinConfig = getConfig().attestcoin;
if (attestcoinConfig.enabled) {
  setAttestcoinRouteConfig({
    enabled: true,
    creditcoinRpcUrl: attestcoinConfig.creditcoinRpcUrl,
    taskStateAddr: attestcoinConfig.taskStateAddr,
  });
  app.route("/", attestcoinRoutes);
  logger.info("Attestcoin routes registered");
}

// Circle nanopayments (EPIC-129) — only when CIRCLE_PAYMENTS_ENABLED=true.
// Master flag off → zero behavior change (old x402 paths stay as-is).
const circleCfg = getConfig().circlePayments;

/**
 * Passport lookup for the 402 identity extension + /api/identity route.
 * EVM address → Hedera account via mirror node → passport NFT check.
 * Server EOA (seller) has no Hedera account — falls back to the
 * operator account, which holds the server's own passport.
 */
const MIRROR_BASE =
  getConfig().hederaNetwork === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com/api/v1"
    : "https://testnet.mirrornode.hedera.com/api/v1";

const circleIdentityLookup = async (
  address: string,
): Promise<
  | {
    passportTokenId: string;
    readinessScore?: number;
    mintTx?: string;
    issuedAt?: string;
    chain?: string;
  }
  | undefined
> => {
  const cfg = getConfig();
  let accountId: string | undefined;
  try {
    const res = await fetch(`${MIRROR_BASE}/accounts/${address}`);
    if (res.ok) {
      const data = (await res.json()) as { account?: string };
      accountId = data.account;
    }
  } catch {
    /* fall through to seller fallback */
  }
  if (
    !accountId &&
    circleCfg &&
    address.toLowerCase() === circleCfg.sellerAddress.toLowerCase()
  ) {
    accountId = cfg.hederaOperatorId;
  }
  if (!accountId) return undefined;

  const nfts = await getNftsForAccount(accountId);
  const nft = nfts.find(
    (n) => n.token_id === cfg.passportTokenId && !n.deleted,
  );
  if (!nft) return undefined;
  return {
    passportTokenId: `${nft.token_id}:${nft.serial_number}`,
    issuedAt: new Date(
      Number(nft.created_timestamp.split(".")[0]) * 1000,
    ).toISOString(),
    chain: "hedera",
  };
};

if (circleCfg?.enabled) {
  try {
    const circleRuntime = createCirclePaymentsRuntime(circleCfg, {
      identityLookup: circleIdentityLookup,
      onFailure: (f) => {
        logger.error("Payment fulfillment failure after confirmed settle", {
          scheme: f.scheme,
          network: f.network,
          payer: f.payer,
          amount: f.amount,
          reason: f.reason,
          txRef: f.txRef,
        });
        captureError(new Error(`payment-fulfillment: ${f.reason}`), {
          tags: { scheme: f.scheme, network: f.network },
        });
      },
    });
    if (circleCfg.identity) {
      app.route(
        "/",
        createIdentityRoutes({
          payment: circleRuntime.paymentFor("identity.verify"),
          lookup: circleRuntime.lookup,
        }),
      );
    }
    // SLICE-129-23: demo pair — verified (extension) vs raw (no extension)
    app.route(
      "/",
      createDemoRoutes({
        verifiedPayment: circleRuntime.paymentFor("demo.data"),
        rawPayment: circleRuntime.paymentFor("demo.data", {
          identity: false,
        }),
      }),
    );
    // SLICE-129-15/16: circle MCP tools — "all" + market namespaces
    setCirclePayToolConfig({ router: circleRuntime.router });
    registerCirclePayTools();
    registerCirclePayTools(marketNs);
    setPaymentStatusToolConfig({ statusLookup: circleRuntime.statusLookup });
    registerPaymentStatusTools();
    registerPaymentStatusTools(marketNs);
    setAgentIdentityToolConfig({ lookup: circleRuntime.lookup });
    registerAgentIdentityTools();
    registerAgentIdentityTools(marketNs);
    setCircleWalletBalanceToolConfig({
      balanceLookup: circleRuntime.balanceLookup,
    });
    registerCircleWalletBalanceTools();
    registerCircleWalletBalanceTools(marketNs);
    setSupportedNetworksToolConfig({
      router: circleRuntime.router,
      getFlags: () => {
        const c = getConfig().circlePayments;
        return {
          gateway: c?.gateway ?? false,
          arc: c?.arc ?? false,
          identity: c?.identity ?? false,
          escrow: c?.escrow ?? false,
        };
      },
    });
    registerSupportedNetworksTools();
    registerSupportedNetworksTools(marketNs);
    setPaymentHistoryToolConfig({
      paymentHistory: circleRuntime.paymentHistory,
    });
    registerPaymentHistoryTools();
    registerPaymentHistoryTools(marketNs);
    logger.info("Circle payments wired", {
      gateway: circleCfg.gateway,
      arc: circleCfg.arc,
      identity: circleCfg.identity,
    });
  } catch (e) {
    logger.error("Failed to wire circle payments — feature disabled", {
      error: e instanceof Error ? e.message : String(e),
    });
    captureError(e instanceof Error ? e : new Error(String(e)), {
      tags: { feature: "circle-payments" },
    });
  }
}

app.route("/", metricsApp);
app.route("/", telemetryApp);
app.route("/", paymentRoutes);

// Monitoring routes (EPIC-99)
const monitoringDataDir = process.env.MONITORING_DATA_DIR ?? ".data/monitoring";
const monitoringStore = createMonitoringStore(monitoringDataDir);
const monitoringApp = createMonitoringRoutes({
  store: monitoringStore,
  now: () => new Date(),
  scanFn: async (url: string) => {
    const { scanDomain } = await import("../agent-readiness/scanner/orchestrator");
    const { RuleEngine } = await import("../agent-readiness/rule-engine/rule-engine");
    const { formatScanReport } = await import("../agent-readiness/report-formatter");
    const sourceState = await scanDomain(url);
    const result = RuleEngine.run(sourceState);
    return formatScanReport(url, result);
  },
});
app.route("/", monitoringApp);

// OpenAPI spec + Swagger UI
const openApiSpecHandler = openAPIRouteHandler(app, {
  documentation: openApiConfig,
  exclude: ["/docs", "/api/specs", "/openapi.json", "/openapi.yaml", "/swagger.json", "/ui", /^\/ui\//, "/metrics", "/api/telemetry"],
  excludeMethods: ["OPTIONS"],
});
app.get("/api/specs", openApiSpecHandler);
// Standard OpenAPI discovery paths (SLICE-47-9)
app.get("/openapi.json", openApiSpecHandler);
app.get("/swagger.json", openApiSpecHandler);
// SLICE-121-3: YAML endpoint for AI-agents that prefer YAML
app.get("/openapi.yaml", async (_c) => {
  const specRes = await app.request("/openapi.json");
  const json = await specRes.json();
  const yamlStr = yamlStringify(json);
  return new Response(yamlStr, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
app.get("/docs", swaggerUI({ url: "/api/specs" }));

// Register MCP tools — default "all" namespace (backward compat)
registerAllTools();
registerComplianceTools();
registerParityTools();
registerKeeperhubTools();

const port = Number(process.env.PORT ?? 4021);

// Rebuild directory cache from HCS in background (SLICE-7-2: graceful degradation)
// Server starts immediately with empty cache; rebuilds in background with retries.
const directoryTopicId = process.env.DIRECTORY_TOPIC_ID;
if (directoryTopicId) {
  startBackgroundRebuild(directoryTopicId, { incremental: true });
}

const a2aTopicId = process.env.A2A_TOPIC_ID;
if (a2aTopicId) {
  startA2ACacheRebuild(a2aTopicId, { incremental: true });
}

const marketTopicId = process.env.MARKET_TOPIC_ID;
if (marketTopicId) {
  startMarketCacheRebuild(marketTopicId, { incremental: true });
}

// SLICE-84-2: Start escrow reconciler background sweeper (config-gated)
import { startEscrowReconciler } from "./services/escrow-reconciler";
startEscrowReconciler();

// Capture unhandled errors from routes
app.onError((err, c) => {
  console.error("[onError]", c.req.method, c.req.path, err);
  captureError(err, {
    tags: { path: c.req.path, method: c.req.method },
  });
  return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, "Internal server error");
});

export function createApp() {
  return app;
}

try {
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
    idleTimeout: 0,
  });
  logger.info("SERVER listening", { url: `http://${server.hostname}:${server.port}` });
} catch (e) {
  logger.error("SERVER: Bun.serve failed", { error: e });
  process.exit(1);
}
