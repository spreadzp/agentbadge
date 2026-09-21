// EPIC-140 (SLICE-140-8): route registry — barrel + register*Routes functions.
// index.ts becomes a table of contents: wire* calls interleave with register*
// calls at the original positions, preserving Hono's registration order.
//
// CRITICAL ORDER (do not collapse into a single call):
//   wireKeeperhubX402(app) → registerApiRoutes(app)     — keeperhub gate first
//   wireScanPacksX402(app) → wireMarketplace(app) → registerPostMarketplaceRoutes(app)
//   wireCirclePayments(app) → registerOpsRoutes(app)

import type { Hono } from "hono";
import { getConfig } from "../../config/env";
import { logger } from "@agentbadge/passport";

import { passportRoutes } from "./passport";
import { verifyRoutes } from "./verify";
import { didRoutes } from "./did";
import { agentRoutes } from "./agents";
import { adminRoutes } from "./admin";
import { upgradeRoutes } from "./upgrade";
import { auditRoutes } from "./audit";
import { eventsRoutes } from "./events";
import { catalogRoutes } from "./catalog";
import { wellKnownRoutes } from "./well-known";
import { agentCardRoutes } from "./agent-card";
import { feedRoutes } from "./feed";
import { mcpRoutes } from "./mcp";

import { landingRoutes } from "./landing";
import { authorityRoutes } from "./authority";
import { hackathonRoutes } from "./hackathon";
import { servicesRoutes } from "./services";
import { uiRoutes } from "./ui";
import { agentGuideRoutes } from "./agent-guide";
import { agentKnowledgeRoutes } from "./agent-knowledge";
import { trustRoutes } from "./trust";
import { trustViewerRoutes } from "./trust-viewer";
import { teamRoutes } from "./agent-guide/team";
import { a2aRoutes } from "./a2a";
import { marketRoutes } from "./market";
import { metaRoutes } from "./meta";
import { searchRoutes } from "./search";
import { marketGuideRoutes } from "./market-guide";
import { medicalGuideRoutes } from "./medical-guide";
import { contactRoutes } from "./contact";
import { contentPageRoutes } from "./content-pages";
import { blogRoutes } from "./blog";

import { webmcpApiRoutes } from "./webmcp-api";
import { keeperhubApiRoutes } from "./keeperhub-api";
import { linkGraphRoutes } from "./link-graph-api";
import { rulesApiRoutes } from "./rules-api";
import { scanRuleRoutes } from "./scan-rule-api";

import { totalScanRoutes } from "./total-scan-api";
import { benchmarkRoutes } from "./benchmark-api";
import { benchmarkPageRoutes } from "./benchmark-pages";
import { teamPageRoutes } from "./team-pages";
import { workRequestRoutes } from "./api/work-requests";
import { workRequestUiRoutes } from "./work-request-ui";
import { demandRoutes } from "./api/demand";
import { demandGuideRoutes } from "./agent-guide/demand";
import { changelogRoutes } from "./changelog";
import { agencyJsonRoutes } from "./agency-json";
import { profileRoutes } from "./profile";
import { profileViewerRoutes } from "./profile-viewer";
import { attestcoinRoutes, setAttestcoinRouteConfig } from "./attestcoin";

import { metricsApp } from "./metrics";
import { telemetryApp } from "./telemetry";
import { paymentRoutes } from "./payment";
import { createMonitoringRoutes } from "./monitoring";
import { createMonitoringStore } from "../../agent-readiness/monitoring/monitoring-store";

// Core API/agent routes — mounted after wireStaticOps, before MCP namespaces.
export function registerCoreRoutes(app: Hono): void {
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
}

// HTML page routes — mounted after wireMcpNamespaceRoutes.
export function registerPageRoutes(app: Hono): void {
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
}

// API routes — MUST be called AFTER wireKeeperhubX402 (its paymentMiddleware
// gates keeperhub paths; Hono composes handlers in registration order).
// webmcpApiRoutes was originally mounted before the keeperhub gate — its paths
// are disjoint from the gate's route map, so the shift is behavior-neutral.
export function registerApiRoutes(app: Hono): void {
  app.route("/api", webmcpApiRoutes);
  app.route("/api", keeperhubApiRoutes);
  app.route("/api", linkGraphRoutes);
  app.route("/api", rulesApiRoutes);
  app.route("/api", scanRuleRoutes);
}

// Mounted AFTER wireScanPacksX402 + wireMarketplace — totalScanRoutes is gated
// by the scan-packs x402 middleware, so it must not move earlier.
export function registerPostMarketplaceRoutes(app: Hono): void {
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
}

// Ops/monitoring API routes — mounted AFTER wireCirclePayments.
export function registerOpsRoutes(app: Hono): void {
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
      const { scanDomain } = await import("../../agent-readiness/scanner/orchestrator");
      const { RuleEngine } = await import("../../agent-readiness/rule-engine/rule-engine");
      const { formatScanReport } = await import("../../agent-readiness/report-formatter");
      const sourceState = await scanDomain(url);
      const result = RuleEngine.run(sourceState);
      return formatScanReport(url, result);
    },
  });
  app.route("/", monitoringApp);
}
