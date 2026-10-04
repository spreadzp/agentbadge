// SLICE-155-5: low-balance signal — sweeper in the venue-cron
// pattern (billing.ts). Reads every active wallet's balance,
// compares to threshold (AGENT_WALLET_LOW_USD), fires an alert:
// logger + audit event + optional global webhook
// (AGENT_WALLET_LOW_WEBHOOK_URL — ARC_BV_WEBHOOK_URL pattern).
// Best-effort: unavailable balance is skipped, never throws.

import { logger } from "@agentbadge/passport";
import type { AgentWalletRecord } from "./registry";
import type { WalletBalance } from "./balance";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LowBalanceEvent {
  address: `0x${string}`;
  usdc: string;
  thresholdUsd: number;
  source: WalletBalance["source"];
  at: number;
}

export interface LowBalanceDeps {
  /** Active wallets to scan — may be async (db backend, SLICE-155-10). */
  wallets: () => AgentWalletRecord[] | Promise<AgentWalletRecord[]>;
  readBalance: (address: `0x${string}`) => Promise<WalletBalance>;
  thresholdUsd: number;
  /** Alert sink — logger+audit+webhook handled by wiring/tests. */
  onAlert?: (ev: LowBalanceEvent) => void | Promise<void>;
  /** Optional global webhook URL (AGENT_WALLET_LOW_WEBHOOK_URL). */
  webhookUrl?: string;
  fetchFn?: typeof fetch;
}

/** One sweep — returns low wallets; alerts fire per wallet. */
export async function checkLowBalances(
  deps: LowBalanceDeps,
): Promise<LowBalanceEvent[]> {
  const out: LowBalanceEvent[] = [];
  for (const rec of await deps.wallets()) {
    if (!rec.active) continue;
    let bal: WalletBalance;
    try {
      bal = await deps.readBalance(rec.address);
    } catch {
      continue; // best-effort mirror
    }
    if (bal.source === "unavailable") continue;
    const usdc = Number(bal.usdc);
    if (!Number.isFinite(usdc) || usdc >= deps.thresholdUsd) continue;
    const ev: LowBalanceEvent = {
      address: rec.address,
      usdc: bal.usdc,
      thresholdUsd: deps.thresholdUsd,
      source: bal.source,
      at: Date.now(),
    };
    out.push(ev);
    logger.warn("agent-wallet: low balance", {
      address: rec.address,
      usdc: bal.usdc,
      thresholdUsd: deps.thresholdUsd,
      venueId: rec.venueId,
    });
    try {
      await deps.onAlert?.(ev);
    } catch {
      /* alert sink must not break the sweep */
    }
    if (deps.webhookUrl) {
      const fetcher = deps.fetchFn ?? fetch;
      try {
        await fetcher(deps.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "agent_wallet_low_balance",
            ...ev,
            venueId: rec.venueId,
          }),
        });
      } catch (e) {
        logger.warn("agent-wallet: low-balance webhook failed", {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  return out;
}

let sweeperTimer: ReturnType<typeof setTimeout> | null = null;

/** Daily low-balance sweeper — env-gated like the venue sweeper. */
export function startLowBalanceSweeper(deps: LowBalanceDeps): void {
  if (sweeperTimer) return;
  const tick = async () => {
    try {
      const low = await checkLowBalances(deps);
      if (low.length > 0) {
        logger.info("agent-wallet: low-balance sweep", {
          wallets: (await deps.wallets()).length,
          low: low.length,
        });
      }
    } catch (e) {
      logger.error("agent-wallet: low-balance sweep error", {
        err: e instanceof Error ? e.message : String(e),
      });
    }
    sweeperTimer = setTimeout(tick, DAY_MS);
  };
  sweeperTimer = setTimeout(tick, 60_000); // first tick 1min after boot
  logger.info("agent-wallet: low-balance sweeper started", {
    intervalMs: DAY_MS,
    thresholdUsd: deps.thresholdUsd,
  });
}

export function stopLowBalanceSweeper(): void {
  if (sweeperTimer) {
    clearTimeout(sweeperTimer);
    sweeperTimer = null;
  }
}
