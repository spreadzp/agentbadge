// EPIC-140 (SLICE-140-6): MCP namespace setup extracted from index.ts.
// Invariant: register*Tools MUST run BEFORE createNamespaceRoutes mounts —
// createNamespaceRoutes calls getNamespace at mount time.
// registerMcpNamespaces() returns handles so circle-payments (140-5) can
// register its tools into the "market" namespace without re-creating it.

import type { Hono } from "hono";
import {
  createNamespace,
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
  registerBstockTools,
  registerBstockTelegramTools,
  type NamespaceRegistry,
} from "@agentbadge/mcp";
import { getConfig } from "../../config/env";
import { getBstockEngine } from "../lib/bstock/engine";
import { ensureBstockService } from "../lib/bstock/service";
import { startBstockFeeds } from "../lib/bstock/feeds";
import {
  getTelegramSubscriptions,
  getBstockTelegramBot,
} from "../../telegram/state";
import { getMarketplaceOps } from "../lib/marketplace";
import { hasAccess } from "@agentbadge/pass-auth";
import { HTTPFacilitator } from "../middleware/x402-base";
import { bstockFreemium } from "../middleware/bstock-freemium";
import {
  bstockAuth,
  bstockRateLimit,
  bstockSseCap,
  BstockSseCap,
} from "../middleware/bstock-gate";
import { registerComplianceTools } from "../../mcp/compliance-tools";
import { registerParityTools } from "../../mcp/parity-tools";
import { registerKeeperhubTools } from "../../mcp/keeperhub-tools";
import { createNamespaceRoutes } from "../routes/mcp-namespace";

export interface McpNamespaces {
  passportNs: NamespaceRegistry;
  marketNs: NamespaceRegistry;
  discoveryNs: NamespaceRegistry;
  auditNs: NamespaceRegistry;
  bstockNs?: NamespaceRegistry;
}

// Register MCP namespace tools BEFORE mounting namespace routes
// (createNamespaceRoutes calls getNamespace at mount time)
export function registerMcpNamespaces(): McpNamespaces {
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

  // EPIC-141: bStock namespace — only when BSTOCK_ENABLED (feature gate).
  const bstockCfg = getConfig().bstock;
  let bstockNs: NamespaceRegistry | undefined;
  if (bstockCfg?.enabled) {
    bstockNs = createNamespace("bstock");
    registerBstockTools(getBstockEngine(), bstockNs);
    registerBstockTelegramTools(
      { subscriptions: getTelegramSubscriptions() },
      bstockNs,
    );
  }

  return { passportNs, marketNs, discoveryNs, auditNs, bstockNs };
}

// Namespace MCP routes — each serves only its namespace's tools
export function wireMcpNamespaceRoutes(app: Hono): void {
  app.route("/mcp/passport", createNamespaceRoutes("passport"));
  app.route("/mcp/market", createNamespaceRoutes("market"));
  app.route("/mcp/discovery", createNamespaceRoutes("discovery"));
  app.route("/mcp/audit", createNamespaceRoutes("audit"));

  // EPIC-141: /mcp/bstock — bearer auth → freemium (free 1/min → 402
  // → x402 → ServicePass) → paid rate limit → SSE cap.
  const bstockCfg = getConfig().bstock;
  if (bstockCfg?.enabled) {
    ensureBstockService();
    const ops = getMarketplaceOps();
    app.use(
      "/mcp/bstock/*",
      bstockAuth(bstockCfg.agentTokens),
      bstockFreemium({
        serviceId: bstockCfg.serviceId,
        priceUsd: bstockCfg.priceUsd,
        durationSec: bstockCfg.durationSec,
        payTo: bstockCfg.payTo,
        networkId: "eip155:84532",
        usdcAddress:
          process.env.X402_USDC_ADDRESS ??
          "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        freePerMin: 1,
        facilitator: new HTTPFacilitator(bstockCfg.facilitatorUrl),
        hasAccess: (wallet, serviceId) =>
          hasAccess(wallet, serviceId as `0x${string}`),
        mintPass: (to, serviceId, durationSec) =>
          ops.mintServicePass(to as `0x${string}`, serviceId, durationSec, 0n),
      }),
      bstockRateLimit(bstockCfg.rateLimitPerMin),
      bstockSseCap(new BstockSseCap(bstockCfg.maxSseConnections)),
    );
    app.route("/mcp/bstock", createNamespaceRoutes("bstock"));

    // Live price feeds — opt-in via BSTOCK_FEED_ENABLED (off in tests).
    if (process.env.BSTOCK_FEED_ENABLED === "true") {
      void startBstockFeeds(getBstockEngine());
    }

    // 141-9/10: Telegram bot — webhook + 1/min alert batch + ~1h digest.
    const bot = getBstockTelegramBot(getBstockEngine());
    if (bot) {
      app.route("/", bot.routes);
      setInterval(() => void bot.alertTick(), 60_000).unref();
      setInterval(() => void bot.digestTick(), 3_600_000).unref();
    }
  }
}

// Register MCP tools — default "all" namespace (backward compat)
export function registerDefaultMcpTools(): void {
  registerAllTools();
  registerComplianceTools();
  registerParityTools();
  registerKeeperhubTools();
}
