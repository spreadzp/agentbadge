/**
 * Payment-received notifications — fans a settled payment event out to
 * operator channels (Discord webhook + Telegram bot).
 *
 * Same env-gated, never-throws pattern as notifyWorkRequest
 * (work-request-notification.ts): when no channel is configured the call
 * is a no-op. Callers should fire-and-forget.
 */

import { sendDiscordMessage, sendTelegramMessage } from "./contact.service";
import { logger } from "@agentbadge/passport/logger";

export interface SettledPayment {
  /** Payer EVM address (from verify/settle). */
  payer: string;
  /** Recipient (payTo). */
  payTo?: string;
  /** Amount in base units (USDC = 6 decimals). */
  amountAtomic: string;
  /** Settlement transaction hash, when the rail reports one. */
  tx?: string;
  /** CAIP-2 network (e.g. eip155:5042). */
  network?: string;
  /** x402 scheme (e.g. exact, arc-self-settle). */
  scheme?: string;
  /** Paid resource URL/path when known. */
  resource?: string;
}

const USDC_DECIMALS = 6n;

/** base units → human amount ("0.30" for 300000). Non-numeric → raw + marker. */
function formatAmount(atomic: string): string {
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

export async function notifyX402Payment(p: SettledPayment): Promise<void> {
  const lines = [
    `💰 x402 payment settled`,
    `Amount: ${formatAmount(p.amountAtomic)} USDC`,
    `Payer: ${p.payer}`,
  ];
  if (p.payTo) lines.push(`Pay to: ${p.payTo}`);
  if (p.network) lines.push(`Network: ${p.network}`);
  if (p.scheme) lines.push(`Scheme: ${p.scheme}`);
  if (p.tx) lines.push(`Tx: ${p.tx}`);
  if (p.resource) lines.push(`Endpoint: ${p.resource}`);
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
    logger.warn("x402 payment notification errors", {
      errors: errors.join("; "),
    });
  }
}
