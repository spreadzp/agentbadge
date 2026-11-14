/**
 * EPIC-252 (SLICE-252-3, D-252-Q3): periodic TG digest worker —
 * hourly «N new requests + top-K cases» into the ops chat.
 * One-way observer only. Env-gated: REQUEST_INBOX_NOTIFY_ENABLED=false
 * disables; missing TELEGRAM_BOT_TOKEN/CHAT_ID → graceful no-op.
 */
import { logger } from "@agentbadge/passport/logger";

import { telegramFromEnv } from "../lib/notify/telegram";
import { sendInboxDigest } from "../lib/request-inbox/tg-digest";
import { pickRequestInboxStores } from "../lib/request-inbox/db-stores";
import { getDatabase } from "../lib/database";

let timer: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const FIRST_TICK_MS = 30_000;

export function startRequestInboxNotifier(opts?: {
  intervalMs?: number;
}): void {
  if (process.env.REQUEST_INBOX_NOTIFY_ENABLED === "false") {
    logger.info("request-inbox notifier disabled (REQUEST_INBOX_NOTIFY_ENABLED=false)");
    return;
  }
  if (timer) {
    logger.warn("request-inbox notifier already running");
    return;
  }
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const tick = async (): Promise<void> => {
    try {
      const cfg = telegramFromEnv();
      if (!cfg) return; // no creds → silent skip
      const stores = pickRequestInboxStores(getDatabase());
      await sendInboxDigest({ stores, cfg });
    } catch (err) {
      logger.error("request-inbox notifier tick failed", { error: err });
    }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, FIRST_TICK_MS).unref?.();
  logger.info("request-inbox notifier started", { intervalMs });
}
