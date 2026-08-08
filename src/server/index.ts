import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { openAPIRouteHandler } from "hono-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HEDERA_TESTNET_CAIP2 } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

import { getPrice, logger } from "@agentgate-hedera/passport";
import { signatureVerificationMiddleware } from "./middleware/signature-verification";
import { mppPaymentMiddleware } from "./middleware/mpp";
import { bazaarExtensionMiddleware } from "./middleware/bazaar-extension";
import {
  startBackgroundRebuild,
  a2aStartBackgroundRebuild as startA2ACacheRebuild,
  marketStartBackgroundRebuild as startMarketCacheRebuild,
} from "@agentgate-hedera/passport";
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
  listTools,
} from "@agentgate-hedera/mcp";
import { registerComplianceTools } from "../mcp/compliance-tools";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestLoggerMiddleware } from "./middleware/request-logger";
import { corsMiddleware } from "./middleware/cors";
import { contentNegotiationMiddleware } from "./middleware/content-negotiation";
import { cacheHeadersMiddleware } from "./middleware/cache-headers";
import { structuredNotFoundHandler } from "./middleware/structured-error-handler";
import { securityHeaders } from "./middleware/security-headers";
import { openApiConfig } from "./openapi";
import { passportRoutes } from "./routes/passport";
import { mcpRoutes } from "./routes/mcp";
import { agentRoutes } from "./routes/agents";
import { verifyRoutes } from "./routes/verify";
import { didRoutes } from "./routes/did";
import { adminRoutes } from "./routes/admin";
import { upgradeRoutes } from "./routes/upgrade";
import { auditRoutes } from "./routes/audit";
import { catalogRoutes } from "./routes/catalog";
import { uiRoutes } from "./routes/ui";
import { landingRoutes } from "./routes/landing";
import { agentGuideRoutes } from "./routes/agent-guide";
import { agentKnowledgeRoutes } from "./routes/agent-knowledge";
import { teamRoutes } from "./routes/agent-guide/team";
import { a2aRoutes } from "./routes/a2a";
import { marketRoutes } from "./routes/market";
import { searchRoutes } from "./routes/search";
import { marketGuideRoutes } from "./routes/market-guide";
import { medicalGuideRoutes } from "./routes/medical-guide";
import { contactRoutes } from "./routes/contact";
import { contentPageRoutes } from "./routes/content-pages";
import { teamPageRoutes } from "./routes/team-pages";
import { workRequestRoutes } from "./routes/api/work-requests";
import { workRequestUiRoutes } from "./routes/work-request-ui";
import { demandRoutes } from "./routes/api/demand";
import { demandGuideRoutes } from "./routes/agent-guide/demand";
import { changelogRoutes } from "./routes/changelog";
import { wellKnownRoutes } from "./routes/well-known";
import { feedRoutes } from "./routes/feed";
import { metricsApp } from "./routes/metrics";
import { telemetryApp } from "./routes/telemetry";
import demo from "./routes/demo";
import { loadConfig } from "../config/env";
import { initSentry, captureError } from "./lib/sentry";
import { ErrorCodes } from "./lib/error-codes";
import { errorResponse } from "./lib/error-response";
import { VerifierRegistry, NoopVerifier, DataHubVerifier } from "../verifiers";

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

// 301 redirect: agent-passport-hedera.fly.dev → agentbadge.xyz (EPIC-22 SLICE-22-4)
app.use(async (c, next) => {
  const host = c.req.header("host") ?? "";
  if (host.includes("agent-passport-hedera.fly.dev")) {
    const url = new URL(c.req.url);
    url.host = "agentbadge.xyz";
    return c.redirect(url.toString(), 301);
  }
  await next();
});

app.use(requestLoggerMiddleware());
app.use(corsMiddleware());
app.use(securityHeaders());
app.use(contentNegotiationMiddleware());
app.use(cacheHeadersMiddleware());
app.use((c, next) => signatureVerificationMiddleware(c as any, next));
app.use(rateLimitMiddleware());
app.use(bazaarExtensionMiddleware());

// Structured 404 handler — JSON for API clients, HTML for browsers
app.notFound(structuredNotFoundHandler());

const isMockMode = process.env.MOCK_HEDERA === "true";
if (!isMockMode) {
  try {
    loadConfig();
    logger.info("Environment configuration validated");
  } catch (e) {
    console.error("[SERVER] Config error:", e);
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

app.get("/health", (c) => {
  const tools = listTools();
  return c.json({
    status: "healthy",
    uptime: process.uptime(),
    mcp: {
      toolsCount: tools.length,
      tools: tools.map((t) => t.name),
    },
    timestamp: Date.now(),
  });
});

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

app.post("/api/indexnow", async (c) => {
  try {
    const body = await c.req.json<{ urls?: string[] }>();
    const urls = body.urls ?? [`${INDEXNOW_BASE}/`];
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

app.route("/", passportRoutes);
app.route("/", verifyRoutes);
app.route("/", didRoutes);
app.route("/", agentRoutes);
app.route("/", adminRoutes);
app.route("/", upgradeRoutes);
app.route("/", auditRoutes);
app.route("/", catalogRoutes);
app.route("/", wellKnownRoutes);
app.route("/", feedRoutes);
app.route("/", mcpRoutes);
app.route("/", landingRoutes);
app.route("/", uiRoutes);
app.route("/", agentGuideRoutes);
app.route("/", agentKnowledgeRoutes);
app.route("/", teamRoutes);
app.route("/", a2aRoutes);
app.route("/", marketRoutes);
app.route("/", searchRoutes);
app.route("/", marketGuideRoutes);
app.route("/", medicalGuideRoutes);
app.route("/", contactRoutes);
app.route("/", contentPageRoutes);
app.route("/", teamPageRoutes);
app.route("/", workRequestRoutes);
app.route("/", workRequestUiRoutes);
app.route("/", demandRoutes);
app.route("/", demandGuideRoutes);
app.route("/", changelogRoutes);
app.route("/api/demo", demo);
app.route("/", metricsApp);
app.route("/", telemetryApp);

// OpenAPI spec + Swagger UI
const openApiSpecHandler = openAPIRouteHandler(app, {
  documentation: openApiConfig,
  exclude: ["/docs", "/api/specs", "/openapi.json", "/swagger.json", "/ui", /^\/ui\//, "/metrics", "/api/telemetry"],
  excludeMethods: ["OPTIONS"],
});
app.get("/api/specs", openApiSpecHandler);
// Standard OpenAPI discovery paths (SLICE-47-9)
app.get("/openapi.json", openApiSpecHandler);
app.get("/swagger.json", openApiSpecHandler);
app.get("/docs", swaggerUI({ url: "/api/specs" }));

// Register MCP tools
registerPassportTools();
registerAuditCatalogTools();
registerDirectoryTools();
registerA2ATools();
registerMarketplaceTools();
registerGuideTools();
registerSigningTools();
registerDiscoveryTools();
registerEscrowTools();
registerDatasetTools();
registerComplianceTools();

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

// Capture unhandled errors from routes
app.onError((err, c) => {
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
  });
  console.error(`[SERVER] Listening on http://${server.hostname}:${server.port}`);
} catch (e) {
  console.error("[SERVER] Bun.serve failed:", e);
  process.exit(1);
}
