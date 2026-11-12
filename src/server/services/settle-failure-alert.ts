/**
 * SLICE-242-10 (D-242-15): settle-failure operator alerts.
 *
 * A failed settle AFTER a valid verify means money was verified but not
 * delivered — operators get pinged immediately on Discord/Telegram, with
 * a 15-minute in-memory dedupe keyed by errorReason (a repeating failure
 * storms logs, not channels; process restart re-arms — acceptable).
 *
 * Verify failures are NOT routed here — they are user noise (log only).
 * Same env-gated, never-throws pattern as notifyX402Payment.
 */

import { sendDiscordMessage, sendTelegramMessage } from "./contact.service";
import { logger } from "@agentbadge/passport/logger";

export interface SettleFailure {
  /** settle.errorReason or fallback text — also the dedupe key. */
  reason: string;
  /** Paid resource URL/path when known. */
  endpoint?: string;
  payer?: string;
  amountAtomic?: string;
  network?: string;
}

/** Dedupe window: identical reason stays silent for this long after first ping. */
const DEDUPE_WINDOW_MS = 15 * 60 * 1000;

const lastSentAt = new Map<string, number>();

/** Test hook — clears dedupe state. */
export function resetSettleFailureDedupe(): void {
  lastSentAt.clear();
}

const USDC_DECIMALS = 6n;

function formatAmount(atomic: string | undefined): string | undefined {
  if (!atomic) return undefined;
  try {
    const a = BigInt(atomic);
    const whole = a / 10n ** USDC_DECIMALS;
    const frac = (a % 10n ** USDC_DECIMALS)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return `${atomic} atomic`;
  }
}

/** True when an alert for this reason should fire now; stamps the timestamp. */
function shouldAlert(reason: string, now = Date.now()): boolean {
  const last = lastSentAt.get(reason);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  lastSentAt.set(reason, now);
  return true;
}

export async function alertSettleFailure(f: SettleFailure): Promise<void> {
  if (!shouldAlert(f.reason)) {
    logger.info("settle-failure-alert: deduped (same reason <15min)", {
      reason: f.reason,
    });
    return;
  }

  const lines = ["🚨 x402 settle FAILED (verified but not settled)", `Reason: ${f.reason}`];
  const amount = formatAmount(f.amountAtomic);
  if (amount) lines.push(`Amount: ${amount} USDC`);
  if (f.payer) lines.push(`Payer: ${f.payer}`);
  if (f.endpoint) lines.push(`Endpoint: ${f.endpoint}`);
  if (f.network) lines.push(`Network: ${f.network}`);
  const message = lines.join("\n");

  const errors: string[] = [];

  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      await sendDiscordMessage({ message });
    } catch (err) {
      errors.push(`Discord: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      await sendTelegramMessage({ message });
    } catch (err) {
      errors.push(`Telegram: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    logger.warn("settle failure notification errors", {
      errors: errors.join("; "),
    });
  }
}
