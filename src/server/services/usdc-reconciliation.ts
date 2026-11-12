/**
 * USDC reconciliation — timer wrapper (EPIC-222-5).
 *
 * Thin env-gated shell over `runReconciliationTick`
 * (lib/payments-api/usdc-reconciliation.ts). Same pattern as
 * usdc-payment-monitor.ts: setInterval + .unref(), skip-overlap
 * guard, per-tick error isolation.
 *
 * Gate (all required — explicit opt-in, D-222-5):
 *   USDC_RECONCILIATION_ENABLED === "true"
 *   ARC_RPC_URL                    — shared Arc JSON-RPC endpoint
 *   >=1 `arc`-labeled usdcNetworks entry (treasury+token configured)
 *
 * Cursor: per-network last-reconciled block persisted via
 * MarketplaceMeta (`usdc-recon-cursor:{caip2}`) when the database
 * is enabled; falls back to an in-memory map otherwise (one
 * lookback-window rescan per restart — harmless: exception ids
 * dedupe).
 */

import {
  createArcChainClient,
  getPaymentNetwork,
  type ArcChainClient,
  type PaymentServiceStores,
} from "@agentbadge/payments";
import { logger } from "@agentbadge/passport/logger";

import { getConfig } from "../../config/env";
import { getDatabase } from "../lib/database";
import {
  runReconciliationTick,
  type ReconciliationCursorStore,
} from "../lib/payments-api/usdc-reconciliation";

let reconTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
const chainClients = new Map<string, ArcChainClient>();
const memoryCursor = new Map<string, bigint>();

const CURSOR_PREFIX = "usdc-recon-cursor:";

function chainFor(
  caip2: string,
  rpcUrl: string | undefined,
): ArcChainClient | undefined {
  if (!rpcUrl) return undefined;
  let client = chainClients.get(caip2);
  if (!client) {
    const net = getPaymentNetwork(caip2);
    if (!net) return undefined;
    client = createArcChainClient({ network: net, rpcUrl });
    chainClients.set(caip2, client);
  }
  return client;
}

/** MarketplaceMeta KV → durable per-network scan cursor.
 *  Database-disabled → process-local map (rescan window on
 *  restart; deterministic exception ids dedupe). */
const cursorStore: ReconciliationCursorStore = {
  async get(caip2) {
    const meta = getDatabase().marketplace;
    if (!meta) return memoryCursor.get(caip2) ?? null;
    const row = await meta.getMeta(`${CURSOR_PREFIX}${caip2}`);
    const block = (row?.payload as { lastBlock?: string } | null)
      ?.lastBlock;
    return block != null ? BigInt(block) : null;
  },
  async set(caip2, block) {
    const meta = getDatabase().marketplace;
    if (!meta) {
      memoryCursor.set(caip2, block);
      return;
    }
    await meta.putMeta(`${CURSOR_PREFIX}${caip2}`, {
      lastBlock: block.toString(),
    });
  },
};

export function startUsdcReconciliation(): void {
  const cfg = getConfig().payments;
  const recon = cfg.usdcReconciliation;
  if (!recon.enabled) {
    logger.info("USDC reconciliation disabled", {
      reason:
        process.env.USDC_RECONCILIATION_ENABLED !== "true"
          ? "USDC_RECONCILIATION_ENABLED is not true"
          : !recon.arcRpcUrl
            ? "ARC_RPC_URL missing"
            : "no arc-labeled usdcNetworks entry",
    });
    return;
  }
  if (reconTimer) {
    logger.warn("USDC reconciliation already running — skip start");
    return;
  }
  const networks = Object.entries(cfg.usdcNetworks)
    .filter(([, n]) => n.label === "arc")
    .map(([caip2]) => caip2);
  if (networks.length === 0) {
    logger.warn("USDC reconciliation: no arc networks — not starting");
    return;
  }
  const treasuryFor = (caip2: string) =>
    cfg.usdcNetworks[caip2]?.recipient;

  const tick = async () => {
    if (ticking) {
      logger.warn("USDC reconciliation: overlapping tick skipped");
      return;
    }
    ticking = true;
    try {
      const stores =
        getDatabase().payments as unknown as PaymentServiceStores;
      await runReconciliationTick({
        stores,
        chainFor: (caip2) => chainFor(caip2, recon.arcRpcUrl),
        networks,
        treasuryFor,
        cursorStore,
        lookbackBlocks: BigInt(recon.lookbackBlocks),
        logger,
      });
    } catch (e) {
      logger.error("USDC reconciliation tick failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      ticking = false;
    }
  };

  void tick();
  reconTimer = setInterval(() => void tick(), recon.intervalMs);
  reconTimer.unref();
  logger.info("USDC reconciliation started", {
    intervalMs: recon.intervalMs,
    lookbackBlocks: recon.lookbackBlocks,
    networks,
  });
}

export function stopUsdcReconciliation(): void {
  if (reconTimer) {
    clearInterval(reconTimer);
    reconTimer = null;
  }
  chainClients.clear();
}

/** Test helper: drop timer + cached clients + in-memory cursors. */
export function resetUsdcReconciliationForTests(): void {
  stopUsdcReconciliation();
  memoryCursor.clear();
}
