import { ethers } from "ethers";
import { Hono } from "hono";
import { passportRoutes } from "../../src/server/routes/passport";
import { verifyRoutes } from "../../src/server/routes/verify";
import { adminRoutes } from "../../src/server/routes/admin";
import { upgradeRoutes } from "../../src/server/routes/upgrade";
import { auditRoutes } from "../../src/server/routes/audit";
import { catalogRoutes } from "../../src/server/routes/catalog";
import { agentRoutes } from "../../src/server/routes/agents";
import { a2aRoutes } from "../../src/server/routes/a2a";
import { marketRoutes } from "../../src/server/routes/market";
import { uiRoutes } from "../../src/server/routes/ui";
import { landingRoutes } from "../../src/server/routes/landing";
import { blogRoutes } from "../../src/server/routes/blog";
import { marketGuideRoutes } from "../../src/server/routes/market-guide";
import { medicalGuideRoutes } from "../../src/server/routes/medical-guide";
import { didRoutes } from "../../src/server/routes/did";
import { mcpRoutes } from "../../src/server/routes/mcp";
import { agentGuideRoutes } from "../../src/server/routes/agent-guide";
import { agentKnowledgeRoutes } from "../../src/server/routes/agent-knowledge";
import { teamRoutes } from "../../src/server/routes/agent-guide/team";
import { metricsApp } from "../../src/server/routes/metrics";
import { telemetryApp } from "../../src/server/routes/telemetry";
import { contentPageRoutes } from "../../src/server/routes/content-pages";
import { teamPageRoutes } from "../../src/server/routes/team-pages";
import { workRequestRoutes } from "../../src/server/routes/api/work-requests";
import { workRequestUiRoutes } from "../../src/server/routes/work-request-ui";
import { demandRoutes } from "../../src/server/routes/api/demand";
import { demandGuideRoutes } from "../../src/server/routes/agent-guide/demand";
import { agencyJsonRoutes } from "../../src/server/routes/agency-json";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { paymentRoutes } from "../../src/server/routes/payment";
import {
  registerPassportTools,
  registerSigningTools,
  registerEscrowTools,
  registerAuditCatalogTools,
  registerDirectoryTools,
  registerA2ATools,
  registerMarketplaceTools,
  registerDatasetTools,
  registerDiscoveryTools,
  registerGuideTools,
  registerAllTools,
  listTools,
  createNamespace,
} from "@agentbadge/mcp";
import { registerComplianceTools } from "../../src/mcp/compliance-tools";
import { registerParityTools } from "../../src/mcp/parity-tools";
import { createNamespaceRoutes } from "../../src/server/routes/mcp-namespace";
import { signatureVerificationMiddleware } from "../../src/server/middleware/signature-verification";
import { corsMiddleware } from "../../src/server/middleware/cors";
import { rateLimitMiddleware } from "../../src/server/middleware/rate-limit";
import { isStripeConfigured } from "../../src/server/lib/stripe-client";

export function makeTestApp(): Hono {
  const app = new Hono();
  app.use(corsMiddleware());
  app.use((c, next) => signatureVerificationMiddleware(c as unknown as Parameters<typeof signatureVerificationMiddleware>[0], next));
  app.use(rateLimitMiddleware());
  app.route("/", passportRoutes);
  app.route("/", verifyRoutes);
  app.route("/", adminRoutes);
  app.route("/", upgradeRoutes);
  app.route("/", auditRoutes);
  app.route("/", catalogRoutes);
  app.route("/", agentRoutes);
  app.route("/", a2aRoutes);
  app.route("/", marketRoutes);
  app.route("/", landingRoutes);
  app.route("/", blogRoutes);
  app.route("/", marketGuideRoutes);
  app.route("/", medicalGuideRoutes);
  app.route("/", uiRoutes);
  app.route("/", didRoutes);
  // Register MCP namespace tools BEFORE mounting namespace routes
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

  app.route("/", mcpRoutes);
  app.route("/mcp/passport", createNamespaceRoutes("passport"));
  app.route("/mcp/market", createNamespaceRoutes("market"));
  app.route("/mcp/discovery", createNamespaceRoutes("discovery"));
  app.route("/mcp/audit", createNamespaceRoutes("audit"));

  // Register all tools on default "all" namespace (aggregator)
  registerAllTools();
  registerComplianceTools();
  registerParityTools();
  app.route("/", agentGuideRoutes);
  app.route("/", agentKnowledgeRoutes);
  app.route("/", teamRoutes);
  app.route("/", metricsApp);
  app.route("/", telemetryApp);
  app.route("/", contentPageRoutes);
  app.route("/", teamPageRoutes);
  app.route("/", workRequestRoutes);
  app.route("/", workRequestUiRoutes);
  app.route("/", demandRoutes);
  app.route("/", demandGuideRoutes);
  app.route("/", agencyJsonRoutes);
  app.route("/", wellKnownRoutes);
  app.route("/", paymentRoutes);

  app.get("/health", (c) => {
    const tools = listTools();
    return c.json({
      status: "healthy",
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

  return app;
}

export function setupMockEnv(): void {
  process.env.MOCK_HEDERA = "true";
  process.env.MOCK_IPFS = "true";
  process.env.PASSPORT_TOKEN_ID = "0.0.9681741";
  process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
  process.env.AUDIT_TOPIC_ID = "0.0.9681981";
  process.env.DIRECTORY_TOPIC_ID = "0.0.9681982";
  process.env.ADMIN_API_KEY = "test-admin-key";
  process.env.IPFS_STORAGE = "./storage/metadata";
}

export async function signWalletOwnership(privateKey: string, accountId: string): Promise<string> {
  const wallet = new ethers.Wallet(privateKey);
  const message = `Request Passport: ${accountId}`;
  return wallet.signMessage(message);
}

export function makeEvmWallet(): { address: string; privateKey: string } {
  const wallet = ethers.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey };
}
