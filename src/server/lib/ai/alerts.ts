/**
 * EPIC-232 (SLICE-232-1, D-232-7): operator alerting for AI guard
 * events (budget exhaustion, etc.) — signer-alerts.ts pattern:
 * cooldown-throttled Telegram via the existing notify seam, channel
 * errors swallowed into logs (a failure to notify is not a failure
 * to degrade).
 */

import { logger } from "@agentbadge/passport/logger";

import { escHtml, sendTelegramMessage, telegramFromEnv } from "../notify/telegram";

export interface AiAlertSenderOpts {
  /** Cooldown between alerts per subject (default 5 min). */
  cooldownMs?: number;
  /** Clock seam for tests. */
  now?: () => number;
  /** Channel seam for tests — defaults to the TG sender. */
  send?: (text: string) => Promise<void>;
}

export type AiAlertSender = (subject: string, text: string) => Promise<void>;

async function defaultSend(text: string): Promise<void> {
  const tg = telegramFromEnv();
  if (!tg) return;
  await sendTelegramMessage(escHtml(text), tg);
}

export function createAiAlertSender(opts: AiAlertSenderOpts = {}): AiAlertSender {
  const cooldown = opts.cooldownMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  const send = opts.send ?? defaultSend;
  const lastAt = new Map<string, number>();

  return async (subject, text) => {
    const t = now();
    const last = lastAt.get(subject) ?? -Infinity;
    if (t - last < cooldown) return;
    lastAt.set(subject, t);
    try {
      await send(text);
    } catch (e) {
      logger.warn("ai alert failed to send", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
}
