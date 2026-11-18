/**
 * SLICE-234-22: Telegram webhook secret-token guard.
 *
 * Telegram sends `X-Telegram-Bot-Api-Secret-Token` on every webhook
 * delivery when `setWebhook` was configured with `secret_token`.
 * Without the check, anyone can forge updates (register arbitrary
 * chat_id↔username bindings, trigger commands, notification hijack).
 *
 * Fail-open when `webhookSecret` is unset (dev/test back-compat —
 * the option is injected); prod sets TELEGRAM_WEBHOOK_SECRET.
 */

import { timingSafeEqual } from "node:crypto";

export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Returns true when the request may proceed:
 * - no secret configured → allow (back-compat)
 * - secret configured → header must match, timing-safe.
 */
export function checkWebhookSecret(
  headerValue: string | undefined,
  webhookSecret: string | undefined,
): boolean {
  if (!webhookSecret) return true;
  if (!headerValue) return false;
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(webhookSecret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
