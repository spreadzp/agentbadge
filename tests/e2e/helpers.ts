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
import { signatureVerificationMiddleware } from "../../src/server/middleware/signature-verification";
import { corsMiddleware } from "../../src/server/middleware/cors";
import { rateLimitMiddleware } from "../../src/server/middleware/rate-limit";

export function makeTestApp(): Hono {
  const app = new Hono();
  app.use(corsMiddleware());
  app.use((c, next) => signatureVerificationMiddleware(c as any, next));
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
  app.route("/", uiRoutes);
  app.route("/", didRoutes);
  app.route("/", mcpRoutes);
  app.route("/", agentGuideRoutes);
  app.route("/", agentKnowledgeRoutes);
  app.route("/", teamRoutes);
  app.route("/", metricsApp);
  app.route("/", telemetryApp);
  app.route("/", contentPageRoutes);
  app.route("/", teamPageRoutes);
  app.route("/", workRequestRoutes);
  app.route("/", workRequestUiRoutes);
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
