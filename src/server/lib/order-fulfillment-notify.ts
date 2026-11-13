/**
 * Post-payment Discord/Telegram notification (extracted from
 * order-fulfillment.ts to keep it under the 300-line lint limit).
 */

import { logger } from "@agentbadge/passport/logger";
import {
  sendDiscordMessage,
  sendTelegramMessage,
} from "../services/contact.service";
import type { FulfillmentInput } from "./payments-api/fulfillment";

/** M-8: attacker-controlled metadata reaches Discord — strip mentions,
 *  markdown control chars and newlines, and cap field length. */
function sanitizeField(v: unknown, maxLen = 100): string {
  if (typeof v !== "string") return "unknown";
  return v
    .slice(0, maxLen)
    .replace(/[\r\n]+/g, " ")
    .replace(/[@#*_~`|]/g, "")
    .trim() || "unknown";
}

export async function notifyPaymentDiscord(
  input: FulfillmentInput,
): Promise<void> {
  const email = sanitizeField(input.email ?? input.buyerRef);
  const amount = input.amountUsd
    ? `$${sanitizeField(input.amountUsd, 20)}`
    : "unknown";
  const message = [
    `💳 New Payment Received`,
    `Product: ${sanitizeField(input.productCode, 64)}`,
    `Amount: ${amount}`,
    `Email: ${email}`,
    `Session: ${sanitizeField(input.paymentRef)}`,
  ].join("\n");

  try {
    await sendDiscordMessage({ message });
    logger.info("fulfillOrder: Discord notification sent", {
      paymentRef: input.paymentRef,
    });
  } catch (err) {
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        await sendTelegramMessage({ message });
        logger.info("fulfillOrder: Telegram notification sent", {
          paymentRef: input.paymentRef,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("fulfillOrder: Telegram notification failed", {
          error: msg,
        });
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("fulfillOrder: Discord notification failed", { error: msg });
  }
}
