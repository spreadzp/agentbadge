/**
 * Telegram bot process state (EPIC-141, SLICE-141-10).
 * Lazy singletons: ChatRegistry + TelegramSubscriptions + bot instance.
 */

import { ChatRegistry } from "./registry";
import { TelegramSubscriptions } from "./subscriptions";
import {
  createBstockTelegramBot,
  makeTelegramSender,
  type BstockTelegramEngine,
} from "./bot";

let registry: ChatRegistry | null = null;
let subscriptions: TelegramSubscriptions | null = null;

export function getTelegramRegistry(): ChatRegistry {
  if (!registry) registry = new ChatRegistry();
  return registry;
}

export function getTelegramSubscriptions(): TelegramSubscriptions {
  if (!subscriptions) {
    subscriptions = new TelegramSubscriptions(getTelegramRegistry());
  }
  return subscriptions;
}

/**
 * Create the bot bound to the shared state. Returns null when
 * TELEGRAM_BOT_BSTOK_TOKEN is unset (bot disabled, webhook not mounted).
 */
export function getBstockTelegramBot(engine: BstockTelegramEngine) {
  const token = process.env.TELEGRAM_BOT_BSTOK_TOKEN;
  if (!token) return null;
  return createBstockTelegramBot({
    registry: getTelegramRegistry(),
    subscriptions: getTelegramSubscriptions(),
    engine,
    send: makeTelegramSender(token),
  });
}

/** Test hook — drop singletons between tests. */
export function resetTelegramState(): void {
  registry = null;
  subscriptions = null;
}
