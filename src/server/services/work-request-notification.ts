/**
 * Work Request Notification Service.
 *
 * SLICE-46-10: Forward notifications to Telegram and Discord
 * when a new work request is created.
 *
 * Uses existing patterns from contact.service.ts.
 */

import {
  sendDiscordMessage,
  sendTelegramMessage,
} from "./contact.service";
import type { WorkRequestRecord } from "./work-request-store";
import { logger } from "@agentgate-hedera/passport";

const MAX_SUMMARY_PREVIEW = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

export function formatWorkRequestNotification(wr: WorkRequestRecord): string {
  const lines = [
    "🔔 New Work Request",
    "",
    `Title: ${wr.request.title}`,
    `Summary: ${truncate(wr.request.summary, MAX_SUMMARY_PREVIEW)}`,
  ];

  if (wr.request.requirements && wr.request.requirements.length > 0) {
    lines.push(`Requirements: ${wr.request.requirements.join(", ")}`);
  }

  if (wr.preferred_contact) {
    lines.push(`Preferred contact: ${wr.preferred_contact.channel}`);
  }

  lines.push("");
  lines.push(`Link: /work-requests/${wr.id}`);

  return lines.join("\n");
}

export async function notifyWorkRequest(wr: WorkRequestRecord): Promise<void> {
  const message = formatWorkRequestNotification(wr);
  const errors: string[] = [];

  // Discord
  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      await sendDiscordMessage({ message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Discord: ${msg}`);
    }
  }

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      await sendTelegramMessage({ message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Telegram: ${msg}`);
    }
  }

  if (errors.length > 0) {
    logger.warn("work-request: notification errors", { errors: errors.join("; ") });
  }
}
