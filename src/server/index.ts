import { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import { signatureVerificationMiddleware } from "./middleware/signature-verification";
import { bazaarExtensionMiddleware } from "./middleware/bazaar-extension";
import { wireL402, wirePaymentGates } from "./wiring/payments";
import { wireKeeperhubX402 } from "./wiring/keeperhub-x402";
import { wireScanPacksX402 } from "./wiring/scan-packs-x402";
import { wireMarketplace } from "./wiring/marketplace-x402";
import { registerMcpNamespaces, wireMcpNamespaceRoutes, registerDefaultMcpTools } from "./wiring/mcp-namespaces";
import { wireCirclePayments } from "./wiring/circle-payments";
import { wireStaticOps, wireOpenApi } from "./wiring/ops";
import { startBackgroundJobs, wireErrorHandler } from "./wiring/background";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestLoggerMiddleware } from "./middleware/request-logger";
import { corsMiddleware } from "./middleware/cors";
import { contentNegotiationMiddleware } from "./middleware/content-negotiation";
import { cacheHeadersMiddleware } from "./middleware/cache-headers";
import { hostNormalizationMiddleware, trailingSlashMiddleware } from "./middleware/canonical-redirects";
import { structuredNotFoundHandler } from "./middleware/structured-error-handler";
import { securityHeaders } from "./middleware/security-headers";
import { ga4Pageview } from "./middleware/ga4-pageview";
import { opsRoutes } from "./routes/ops";
import { linkedinRoutes } from "./routes/linkedin";
import { getDatabase } from "./lib/database";
import {
  registerCoreRoutes,
  registerPageRoutes,
  registerApiRoutes,
  registerPostMarketplaceRoutes,
  registerOpsRoutes,
} from "./routes";
import { loadConfig } from "../config/env";
import { initSentry } from "./lib/sentry";
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
// EPIC-140: extracted to wiring/payments.ts — must stay BEFORE signature/rateLimit.
wireL402(app);
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

// EPIC-143: database init — DATABASE_ENABLED=false/unset → in-memory
// fallback, zero behavior change. Probe is async + non-fatal: a bad URL
// logs an error and health reports db:"down" instead of crash-looping.
const database = getDatabase();
if (database.db) {
  database
    .health()
    .then((up) => {
      if (up) {
        logger.info("database: connected");
      } else {
        logger.error("database: health probe failed", {});
      }
    })
    .catch((e) => logger.error("database: health probe error", { error: e }));
} else {
  logger.info("database: disabled (in-memory)");
}

// EPIC-140: x402 Hedera + MPP/Stripe + Base x402 gates extracted to
// wiring/payments.ts — must stay AFTER notFound + config validation, BEFORE routes.
wirePaymentGates(app);

app.route("/", linkedinRoutes);

// EPIC-140: ops routes (health, redirects, indexnow) extracted to routes/ops.ts
app.route("/", opsRoutes);

// EPIC-140: static-file middleware extracted to wiring/ops.ts
wireStaticOps(app);


// EPIC-140: core routes extracted to routes/index.ts
registerCoreRoutes(app);

// Register MCP namespace tools BEFORE mounting namespace routes
// (createNamespaceRoutes calls getNamespace at mount time)
// EPIC-140: extracted to wiring/mcp-namespaces.ts
const namespaces = registerMcpNamespaces();
wireMcpNamespaceRoutes(app);
// EPIC-140: page routes extracted to routes/index.ts
registerPageRoutes(app);

// x402 premium payment middleware — MUST be registered before keeperhubApiRoutes:
// Hono composes handlers in registration order, so middleware added after the route never runs.
// EPIC-140: extracted to wiring/keeperhub-x402.ts
wireKeeperhubX402(app);
// EPIC-140: api routes extracted to routes/index.ts (webmcp moved here — disjoint paths)
registerApiRoutes(app);
// EPIC-140: scanPacks catalog mount + x402 dynamic-pricing gate extracted to
// wiring/scan-packs-x402.ts — MUST stay before totalScanRoutes (Hono composes in order).
wireScanPacksX402(app);

// EPIC-138, SLICE-138-3: marketplace routes — gated by marketplace.enabled.
// EPIC-140: extracted to wiring/marketplace-x402.ts — gate + mounts inside.
wireMarketplace(app);
// EPIC-140: post-marketplace routes extracted to routes/index.ts
registerPostMarketplaceRoutes(app);

// Circle nanopayments (EPIC-129) — only when CIRCLE_PAYMENTS_ENABLED=true.
// Master flag off → zero behavior change (old x402 paths stay as-is).
// EPIC-140: extracted to wiring/circle-payments.ts
wireCirclePayments(app, { marketNs: namespaces.marketNs });

// EPIC-140: ops/monitoring routes extracted to routes/index.ts
registerOpsRoutes(app);


// Register MCP tools — default "all" namespace (backward compat)
// EPIC-140: extracted to wiring/mcp-namespaces.ts
registerDefaultMcpTools();

const port = Number(process.env.PORT ?? 4021);

// EPIC-140: background cache rebuilds + escrow reconciler extracted to wiring/background.ts
startBackgroundJobs();

// OpenAPI spec + Swagger UI — MUST run after all route mounts
// (openAPIRouteHandler introspects app at call time). EPIC-140: wiring/ops.ts
wireOpenApi(app);

// Capture unhandled errors from routes — EPIC-140: extracted to wiring/background.ts
wireErrorHandler(app);

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

  // EPIC-143: graceful shutdown — the ONLY place database.close() is called
  // (shared pool; never close per-request).
  const shutdown = async (signal: string) => {
    logger.info("SERVER shutting down", { signal });
    try {
      await database.close();
    } catch (e) {
      logger.error("database: close failed", { error: e });
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
} catch (e) {
  logger.error("SERVER: Bun.serve failed", { error: e });
  process.exit(1);
}
