/**
 * EPIC-173 (SLICE-173-4): signer-down operator alerting.
 *
 * Alert-scenario deliverable: a dead signer service (socket backend)
 * pages the operator on the existing channels — Discord webhook +
 * Telegram bot (contact.service.ts), same pattern as work-request
 * notifications. Throttled: the health-gate fires per paid request —
 * without a cooldown every retry would re-alert. One alert per
 * SIGNER_ALERT_COOLDOWN_MS (default 5 min), reset on success.
 *
 * Alerting must never break the gate — channel errors are swallowed
 * into logs; a failure to notify is not a failure to refuse.
 */

import { logger } from "@agentbadge/passport/logger";
import {
  sendDiscordMessage,
  sendTelegramMessage,
} from "../../services/contact.service";

export interface SignerDownNotifierOpts {
  /** Cooldown between alerts (ms). Default 5 min. */
  cooldownMs?: number;
  /** Clock seam for tests. */
  now?: () => number;
  /** Channel seam for tests — defaults to contact.service sends. */
  send?: (message: string) => Promise<void>;
}

export function createSignerDownNotifier(
  opts: SignerDownNotifierOpts = {},
): (err: Error) => Promise<void> {
  const cooldown = opts.cooldownMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  let lastAlertAt = -Infinity;

  const send = opts.send ?? defaultSend;

  return async (err: Error) => {
    const t = now();
    if (t - lastAlertAt < cooldown) return;
    lastAlertAt = t;
    const message = [
      "🚨 Signer service DOWN",
      "",
      `Time: ${new Date(t).toISOString()}`,
      `Error: ${err.message}`,
      "",
      "Paid routes are refusing with 503 signer_unavailable (no charge taken).",
      "Free routes unaffected. Restart: the supervisor loop self-heals;",
      "check `bun src/signer-service/index.ts` / SIGNER_SOCKET_PATH on the machine.",
    ].join("\n");
    try {
      await send(message);
    } catch (e) {
      logger.warn("signer-down alert failed to send", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
}

/** Fan out over whatever operator channels are configured. */
async function defaultSend(message: string): Promise<void> {
  const errors: string[] = [];
  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      await sendDiscordMessage({ message });
    } catch (e) {
      errors.push(`discord: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      await sendTelegramMessage({ message });
    } catch (e) {
      errors.push(`telegram: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length) {
    logger.warn("signer-down alert channel errors", { errors });
  }
}
