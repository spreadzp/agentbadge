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
import { getMarketplaceOps, getMarketplaceOpsFor, arcChainFor } from "../lib/marketplace";
import { hasAccess } from "@agentbadge/pass-auth";
import {
  ARC_TESTNET,
  ARC_MAINNET,
  ARC_MAINNET_AGENTBADGE_CONTRACTS,
  ARC_SELF_SETTLE_SCHEME,
} from "@agentbadge/circle-payments";
import { createArcBstockFacilitator } from "../lib/bstock/arc-facilitator";
import { getSpendEnforcer } from "../lib/agent-wallet/enforcer";
import { bstockFreemium } from "../middleware/bstock-freemium";
import { bazaarExtensionFor } from "../lib/service-catalog/bazaar";
import { bstockFeedHealth } from "../middleware/bstock-feed-health";
import { wrapBstockEngine } from "../lib/data-status";
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
    // SLICE-181-3: views carry data_status/degraded markers (D-181-4).
    registerBstockTools(wrapBstockEngine(getBstockEngine()), bstockNs);
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
    // SLICE-151-7: settlement chain selected by BSTOCK_ARC_NETWORK.
    // Mainnet (eip155:5042) → ARC_MAINNET rail + BSTOCK_NFT contract;
    // default stays testnet (MARKETPLACE_NFT shared with marketplace).
    const isMainnet = bstockCfg.arcNetwork === ARC_MAINNET.caip2;
    const chain = isMainnet ? ARC_MAINNET : ARC_TESTNET;
    const nftAddress = isMainnet
      ? (bstockCfg.nftAddress ??
        ARC_MAINNET_AGENTBADGE_CONTRACTS.marketplacePassNFT)
      : undefined;
    const ops = isMainnet
      ? getMarketplaceOpsFor({
        chain: arcChainFor(bstockCfg.arcNetwork),
        nftAddress,
      })
      : getMarketplaceOps();
    const rpcUrl = isMainnet
      ? (process.env.ARC_MAINNET_RPC_URL ?? ARC_MAINNET.rpcUrl)
      : (process.env.ARC_RPC_URL ?? ARC_TESTNET.rpcUrl);
    app.use(
      "/mcp/bstock/*",
      // SLICE-181-3: dead feed → 503 data_unavailable before payment.
      bstockFeedHealth(getBstockEngine()),
      bstockAuth(bstockCfg.agentTokens),
      bstockFreemium({
        serviceId: bstockCfg.serviceId,
        priceUsd: bstockCfg.priceUsd,
        durationSec: bstockCfg.durationSec,
        payTo: bstockCfg.payTo,
        // SLICE-141-13: Arc self-settle rail — client broadcasts
        // transferWithAuthorization on Arc, we verify the receipt.
        networkId: chain.caip2,
        usdcAddress: chain.usdc,
        scheme: ARC_SELF_SETTLE_SCHEME,
        maxTimeoutSeconds: 345600,
        extra: { assetTransferMethod: ARC_SELF_SETTLE_SCHEME },
        extensions: bazaarExtensionFor("bstock:service-pass"),
        freePerMin: 1,
        facilitator: createArcBstockFacilitator({
          sellerAddress: bstockCfg.payTo,
          chain,
          rpcUrl,
        }),
        hasAccess: (wallet, serviceId) =>
          hasAccess(wallet, serviceId as `0x${string}`, {
            nftAddress: nftAddress as `0x${string}` | undefined,
            rpcUrl,
          }),
        mintPass: (to, serviceId, durationSec) =>
          ops.mintServicePass(to as `0x${string}`, serviceId, durationSec, 0n),
        // SLICE-155-2: spend envelope — lazy getter, off = pass-through.
        spendEnvelope: getSpendEnforcer,
      }),
      bstockRateLimit(bstockCfg.rateLimitPerMin),
      bstockSseCap(new BstockSseCap(bstockCfg.maxSseConnections)),
    );
    app.route("/mcp/bstock", createNamespaceRoutes("bstock"));

    // Live price feeds — opt-in via BSTOCK_FEED_ENABLED (off in tests).
    if (process.env.BSTOCK_FEED_ENABLED === "true") {
      void startBstockFeeds(getBstockEngine());
    }

    // 141-9/10: Telegram bot — webhook + on-demand commands.
    // digestTick always runs but only delivers to /hourly opt-in chats
    // (empty set → no-op). 1/min alert push stays opt-in via env (spammy).
    const bot = getBstockTelegramBot(getBstockEngine());
    if (bot) {
      app.route("/", bot.routes);
      setInterval(() => void bot.digestTick(), 3_600_000).unref();
      if (process.env.BSTOCK_TG_PUSH_ENABLED === "true") {
        setInterval(() => void bot.alertTick(), 60_000).unref();
      }
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
