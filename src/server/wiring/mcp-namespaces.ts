// EPIC-140 (SLICE-140-6): MCP namespace setup extracted from index.ts.
// Invariant: register*Tools MUST run BEFORE createNamespaceRoutes mounts —
// createNamespaceRoutes calls getNamespace at mount time.
// registerMcpNamespaces() returns handles so circle-payments (140-5) can
// register its tools into the "market" namespace without re-creating it.

import type { Hono } from "hono";
import { keccak256, encodePacked, stringToHex } from "viem";
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
  registerFxDeltaTools,
  registerFxDeltaTelegramTools,
  type FxDeltaEngineLike,
  type NamespaceRegistry,
} from "@agentbadge/mcp";
import { getConfig } from "../../config/env";
import { getBstockEngine } from "../lib/bstock/engine";
import { ensureBstockService } from "../lib/bstock/service";
import { startBstockFeeds } from "../lib/bstock/feeds";
import {
  getTelegramSubscriptions,
  getBstockTelegramBot,
  getFxDeltaTelegramSubscriptions,
  getFxDeltaTelegramBot,
} from "../../telegram/state";
import { getFxDeltaRuntime } from "../lib/fx-delta";
import { getFxDeltaFacilitator } from "../lib/fx-delta/facilitator-env";
import {
  CELO_X402_ASSETS,
  CELO_X402_NETWORK,
  CELO_X402_SCHEME,
} from "../lib/fx-delta/celo-assets";
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
  fxdeltaNs?: NamespaceRegistry;
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

  // EPIC-191 (SLICE-191-7): fxdelta namespace — only when
  // FXDELTA_ENABLED + engine runtime injected at boot.
  let fxdeltaNs: NamespaceRegistry | undefined;
  if (process.env.FXDELTA_ENABLED === "true") {
    const rt = getFxDeltaRuntime();
    if (rt) {
      fxdeltaNs = createNamespace("fxdelta");
      registerFxDeltaTools(rt.engine as FxDeltaEngineLike, fxdeltaNs);
      registerFxDeltaTelegramTools(
        { subscriptions: getFxDeltaTelegramSubscriptions() },
        fxdeltaNs,
      );
    }
  }

  return { passportNs, marketNs, discoveryNs, auditNs, bstockNs, fxdeltaNs };
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

  // EPIC-191 (SLICE-191-7): /mcp/fxdelta — bearer auth → freemium
  // (free 1/min → 402 → Celo x402 self-settle) → rate limit → SSE cap.
  // Namespace only exists when registerMcpNamespaces saw the runtime.
  if (process.env.FXDELTA_ENABLED === "true" && getFxDeltaRuntime()) {
    const rt = getFxDeltaRuntime()!;
    const tokens = new Map<string, string>();
    for (const pair of (
      process.env.FXDELTA_AGENT_TOKENS ??
      process.env.MCP_AGENT_TOKENS ??
      ""
    ).split(",")) {
      const i = pair.indexOf(":");
      if (i > 0) tokens.set(pair.slice(i + 1).trim(), pair.slice(0, i).trim());
    }
    const fac = getFxDeltaFacilitator();
    app.use(
      "/mcp/fxdelta/*",
      bstockAuth(tokens),
      ...(fac
        ? [
            bstockFreemium({
              // Per-request paid gate (no pass minting) — serviceId is
              // only a payer-binding attribution key here.
              serviceId: keccak256(
                encodePacked(
                  ["bytes32"],
                  [stringToHex("fxdelta-celo-premium", { size: 32 })],
                ),
              ),
              priceUsd: process.env.FXDELTA_PRICE_USD ?? "0.005",
              durationSec: 300,
              payTo: process.env.FXDELTA_PAY_TO ?? "",
              networkId: CELO_X402_NETWORK,
              usdcAddress: CELO_X402_ASSETS.USDC.address,
              scheme: CELO_X402_SCHEME,
              freePerMin: 1,
              facilitator: fac,
            }),
          ]
        : []),
      bstockRateLimit(
        Number(process.env.FXDELTA_RATE_LIMIT_PER_MIN ?? 60),
      ),
      bstockSseCap(
        new BstockSseCap(
          Number(process.env.FXDELTA_MAX_SSE ?? 20),
        ),
      ),
    );
    app.route("/mcp/fxdelta", createNamespaceRoutes("fxdelta"));

    // Telegram bot — webhook + on-demand commands (DM model).
    const fxBot = getFxDeltaTelegramBot(rt.engine);
    if (fxBot) {
      app.route("/", fxBot.routes);
      setInterval(() => void fxBot.digestTick(), 3_600_000).unref();
      if (process.env.FXDELTA_TG_PUSH_ENABLED === "true") {
        setInterval(() => void fxBot.alertTick(), 60_000).unref();
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
