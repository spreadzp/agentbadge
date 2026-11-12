/**
 * USDC payment monitor — timer wrapper (EPIC-222-3).
 *
 * Thin env-gated shell over `runUsdcMonitorTick`
 * (lib/payments-api/usdc-monitor.ts). Pattern follows
 * bounty-lease-sweeper.ts: setInterval + .unref(), skip-overlap
 * guard, per-tick error isolation.
 *
 * Gate (all required — explicit opt-in, D-222-3):
 *   USDC_MONITOR_ENABLED === "true"
 *   ARC_RPC_URL                    — Arc JSON-RPC endpoint
 *   >=1 `arc`-labeled usdcNetworks entry (treasury+token configured)
 * Off → logs the skip reason, no timer, no RPC, zero behavior change.
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
  dispatchFulfillment,
  getPaymentsCheckout,
} from "../lib/payments-api";
import { runUsdcMonitorTick } from "../lib/payments-api/usdc-monitor";

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
const chainClients = new Map<string, ArcChainClient>();

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

export function startUsdcPaymentMonitor(): void {
  const cfg = getConfig().payments;
  const mon = cfg.usdcMonitor;
  if (!mon.enabled) {
    logger.info("USDC monitor disabled", {
      reason:
        process.env.USDC_MONITOR_ENABLED !== "true"
          ? "USDC_MONITOR_ENABLED is not true"
          : !mon.arcRpcUrl
            ? "ARC_RPC_URL missing"
            : "no arc-labeled usdcNetworks entry",
    });
    return;
  }
  if (monitorTimer) {
    logger.warn("USDC monitor already running");
    return;
  }

  const tick = async () => {
    if (ticking) return; // skip overlapping ticks
    ticking = true;
    try {
      const stores =
        getDatabase().payments as unknown as PaymentServiceStores;
      const checkout = getPaymentsCheckout();
      const result = await runUsdcMonitorTick({
        stores,
        confirm: (input) => checkout.confirmPayment(input),
        fulfill: async (paymentId) => {
          const input = await checkout.getFulfillmentInput(paymentId);
          if (!input) {
            throw new Error(`no fulfillment input for ${paymentId}`);
          }
          const status = await dispatchFulfillment(input, {
            dedupeKey: `payment:${paymentId}`,
            events: stores.events,
          });
          if (status === "no-handler") {
            throw new Error(`no fulfillment handler for ${paymentId}`);
          }
        },
        chainFor: (caip2) => chainFor(caip2, mon.arcRpcUrl),
        treasuryFor: (caip2) => cfg.usdcNetworks[caip2]?.recipient,
        lookbackBlocks: BigInt(mon.lookbackBlocks),
        logger,
      });
      if (
        result.confirmed > 0 ||
        result.flagged > 0 ||
        result.rejected > 0 ||
        result.errors.length > 0
      ) {
        logger.info("USDC monitor tick", {
          payableAttempts: result.payableAttempts,
          transfersSeen: result.transfersSeen,
          confirmed: result.confirmed,
          flagged: result.flagged,
          rejected: result.rejected,
          errors: result.errors.slice(0, 5),
        });
      }
    } catch (e) {
      logger.error("USDC monitor tick failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      ticking = false;
    }
  };

  monitorTimer = setInterval(tick, mon.intervalMs);
  monitorTimer.unref();
  logger.info("USDC monitor started", {
    intervalMs: mon.intervalMs,
    lookbackBlocks: mon.lookbackBlocks,
  });
}

export function stopUsdcPaymentMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

/** Test hook — clears cached chain clients between suites. */
export function resetUsdcMonitorForTests(): void {
  stopUsdcPaymentMonitor();
  chainClients.clear();
  ticking = false;
}
