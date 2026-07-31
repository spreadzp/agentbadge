import { Hono } from "hono";
import { compress } from "hono/compress";
import { serveStatic } from "@hono/node-server/serve-static";
import { openAPIRouteHandler } from "hono-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HEDERA_TESTNET_CAIP2 } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

import { getPrice, logger } from "@agentgate-hedera/passport";
import { signatureVerificationMiddleware } from "./middleware/signature-verification";
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
  listTools,
} from "@agentgate-hedera/mcp";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestLoggerMiddleware } from "./middleware/request-logger";
import { corsMiddleware } from "./middleware/cors";
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
import { a2aRoutes } from "./routes/a2a";
import { marketRoutes } from "./routes/market";
import { searchRoutes } from "./routes/search";
import { marketGuideRoutes } from "./routes/market-guide";
import { medicalGuideRoutes } from "./routes/medical-guide";
import { contactRoutes } from "./routes/contact";
import { contentPageRoutes } from "./routes/content-pages";
import { changelogRoutes } from "./routes/changelog";
import { wellKnownRoutes } from "./routes/well-known";
import demo from "./routes/demo";
import { loadConfig } from "../config/env";
import { initSentry, captureError } from "./lib/sentry";
import { ErrorCodes } from "./lib/error-codes";
import { errorResponse } from "./lib/error-response";

// Initialize Sentry before anything else (no-op if SENTRY_DSN not set)
initSentry();

const app = new Hono();

app.use(corsMiddleware());
app.use(securityHeaders());
app.use(compress());
app.use(requestLoggerMiddleware());
app.use((c, next) => signatureVerificationMiddleware(c as any, next));
app.use(rateLimitMiddleware());

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

// Serve static files from public/ (favicon, icons, logo, CSS)
app.use("/favicon.ico", (c, next) => {
  c.header("Cache-Control", "public, max-age=86400");
  return next();
}, serveStatic({ root: "./public", path: "/favicon.ico" }));
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
app.route("/", mcpRoutes);
app.route("/", landingRoutes);
app.route("/", uiRoutes);
app.route("/", agentGuideRoutes);
app.route("/", a2aRoutes);
app.route("/", marketRoutes);
app.route("/", searchRoutes);
app.route("/", marketGuideRoutes);
app.route("/", medicalGuideRoutes);
app.route("/", contactRoutes);
app.route("/", contentPageRoutes);
app.route("/", changelogRoutes);
app.route("/api/demo", demo);

// OpenAPI spec + Swagger UI
app.get(
  "/api/specs",
  openAPIRouteHandler(app, {
    documentation: openApiConfig,
    exclude: ["/docs", "/api/specs", "/ui", /^\/ui\//],
    excludeMethods: ["OPTIONS"],
  }),
);
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
