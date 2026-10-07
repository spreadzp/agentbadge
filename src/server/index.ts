import { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import { signatureVerificationMiddleware } from "./middleware/signature-verification";
import { bazaarExtensionMiddleware } from "./middleware/bazaar-extension";
import { bazaarExtensionFor } from "./lib/service-catalog/bazaar";
import { wireL402, wirePaymentGates } from "./wiring/payments";
import { wireKeeperhubX402 } from "./wiring/keeperhub-x402";
import { wireScanPacksX402 } from "./wiring/scan-packs-x402";
import { wireMarketplace } from "./wiring/marketplace-x402";
import { registerMcpNamespaces, wireMcpNamespaceRoutes, registerDefaultMcpTools } from "./wiring/mcp-namespaces";
import { wireCirclePayments } from "./wiring/circle-payments";
import { wireEaas } from "./wiring/eaas";
import { configureVenueBilling } from "./routes/venue-api";
import { createSettleSeam } from "./lib/x402-settle-seam";
import { venueMonthlyPriceAtomic } from "./lib/venue/billing";
import { wireAgentWallet, wireSpendEnvelopeGates } from "./wiring/agent-wallet";
import { wireStaticOps, wireOpenApi } from "./wiring/ops";
import { startBackgroundJobs, wireErrorHandler } from "./wiring/background";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { CacheRateLimitStore } from "./middleware/rate-limit-redis-store";
import { getCache } from "./lib/cache";
import { requestLoggerMiddleware } from "./middleware/request-logger";
import { corsMiddleware } from "./middleware/cors";
import { contentNegotiationMiddleware } from "./middleware/content-negotiation";
import {
  markdownNegotiation,
  markdownMirrorRoutes,
} from "./middleware/markdown-negotiation";
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
import { loadConfig, getConfig } from "../config/env";
import { initSentry } from "./lib/sentry";
import { VerifierRegistry, NoopVerifier, DataHubVerifier } from "../verifiers";
import { setDiscoveryApp } from "./routes/discovery";

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
// SLICE-178-4: Accept: text/markdown negotiation for public HTML pages
// (post-response transform; homepage '/' is owned by content-negotiation).
app.use(markdownNegotiation());
app.use(cacheHeadersMiddleware());
// SLICE-49-19: L402 Lightning payment middleware (before signature verification)
// EPIC-140: extracted to wiring/payments.ts — must stay BEFORE signature/rateLimit.
wireL402(app);
app.use((c, next) => signatureVerificationMiddleware(c as unknown as Parameters<typeof signatureVerificationMiddleware>[0], next));
// EPIC-144: shared cache-backed counters when CACHE_ENABLED, else MemoryStore.
app.use(
  rateLimitMiddleware(
    getConfig().cache?.enabled
      ? { store: new CacheRateLimitStore(getCache()) }
      : undefined,
  ),
);
app.use(bazaarExtensionMiddleware());

// SLICE-130-7: GA4 pageview tracking — fire-and-forget for HTML 200 GET responses
app.use(ga4Pageview);

// EPIC-155 SLICE-155-2: spend-envelope path gates. MUST register before
// the gated route mounts (eaas verdicts/evaluate, venue subscribe) —
// Hono runs app.use in registration order. Enforcer resolved lazily
// per request, so feature-off = pass-through.
wireSpendEnvelopeGates(app);

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
    .then((up: boolean) => {
      if (up) {
        logger.info("database: connected");
      } else {
        logger.error("database: health probe failed", {});
      }
    })
    .catch((e: unknown) =>
      logger.error("database: health probe error", { error: e }),
    );
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

// Circle nanopayments (EPIC-129/156) — only when CIRCLE_PAYMENTS_ENABLED=true.
// Master flag off → zero behavior change (old x402 paths stay as-is).
// SLICE-156-1: hoisted ABOVE the x402 gates so keeperhub/scan-packs migrate
// onto the shared runtime (multi-chain accepts) when it exists.
// EPIC-140: extracted to wiring/circle-payments.ts
const circleRuntime = wireCirclePayments(app, { marketNs: namespaces.marketNs });

// SLICE-156-1: venue subscribe seam — x402 settle via the shared router
// (PAYMENT-REQUIRED header stamped on the route's own 402).
if (circleRuntime && process.env.ARC_VENUE_ENABLED === "true") {
  configureVenueBilling({
    subscriptionSettle: createSettleSeam({
      router: circleRuntime.router,
      amountAtomic: () => venueMonthlyPriceAtomic().toString(),
      description: "Venue subscription — monthly",
      resourceUrl: `${(process.env.BASE_URL ?? "https://agentbadge.xyz").replace(/\/$/, "")}/api/venue`,
      extensions: bazaarExtensionFor("venue:instance-subscription"),
    }),
  });
  logger.info("venue billing wired: subscriptionSettle via circle-payments runtime");
}

// x402 premium payment middleware — MUST be registered before keeperhubApiRoutes:
// Hono composes handlers in registration order, so middleware added after the route never runs.
// EPIC-140: extracted to wiring/keeperhub-x402.ts
wireKeeperhubX402(app, { runtime: circleRuntime });
// EPIC-140: api routes extracted to routes/index.ts (webmcp moved here — disjoint paths)
registerApiRoutes(app);
// EPIC-140: scanPacks catalog mount + x402 dynamic-pricing gate extracted to
// wiring/scan-packs-x402.ts — MUST stay before totalScanRoutes (Hono composes in order).
wireScanPacksX402(app, { runtime: circleRuntime });

// EPIC-138, SLICE-138-3: marketplace routes — gated by marketplace.enabled.
// EPIC-140: extracted to wiring/marketplace-x402.ts — gate + mounts inside.
wireMarketplace(app, { runtime: circleRuntime });
// EPIC-140: post-marketplace routes extracted to routes/index.ts
registerPostMarketplaceRoutes(app);

// EPIC-156: circlePayments hoisted above (line ~150) — runtime feeds the
// x402 gates; this block intentionally left as the EAAS comment anchor.

// EPIC-154 SLICE-154-2: EaaS verdict API (x402-gated POST + free GETs).
// Requires circle payments runtime for pricing; no-op when either flag off.
wireEaas(app, { circleRuntime });

// EPIC-155 SLICE-155-1: agent wallet registry (wallet↔agentId↔venue) +
// Circle CLI read mirror. Gated on AGENT_WALLET_ENABLED; CLI missing →
// graceful "unavailable", registry works regardless.
wireAgentWallet(app);

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

// EPIC-178: wire app into discovery routes so /llms.txt enumerates the
// full public route table (post-mount, lazy first-request generation).
setDiscoveryApp(app);

// SLICE-178-4: `GET /<page>.md` mirrors — internal Accept: text/markdown
// sub-request, so mirror content ≡ negotiated content. Registered LAST:
// the `*` catch-all must not shadow any real route.
app.route("/", markdownMirrorRoutes(app));

// Capture unhandled errors from routes — EPIC-140: extracted to wiring/background.ts
wireErrorHandler(app);

export function createApp() {
  return app;
}

if (import.meta.main) {
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
}
