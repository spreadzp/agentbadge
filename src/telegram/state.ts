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
import {
  createFxDeltaTelegramBot,
  makeFxDeltaTelegramSender,
  type FxDeltaTelegramEngine,
} from "./fxdelta-bot";

let registry: ChatRegistry | null = null;
let subscriptions: TelegramSubscriptions | null = null;
// FX-delta gets its own registry/subscriptions (191-7): an agent can
// subscribe to both services, and chat_id bindings are per-bot.
let fxRegistry: ChatRegistry | null = null;
let fxSubscriptions: TelegramSubscriptions | null = null;

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
  const registry = getTelegramRegistry();
  // Boot hydration (D11): restore persisted chat bindings. Fire-and-forget
  // here (sync factory) — register() also awaits it internally, so the
  // registry is deterministic even if a webhook arrives mid-hydration.
  void registry.hydrate();
  return createBstockTelegramBot({
    registry,
    subscriptions: getTelegramSubscriptions(),
    engine,
    send: makeTelegramSender(token),
  });
}

export function getFxDeltaTelegramRegistry(): ChatRegistry {
  if (!fxRegistry) fxRegistry = new ChatRegistry();
  return fxRegistry;
}

export function getFxDeltaTelegramSubscriptions(): TelegramSubscriptions {
  if (!fxSubscriptions) {
    fxSubscriptions = new TelegramSubscriptions(
      getFxDeltaTelegramRegistry(),
    );
  }
  return fxSubscriptions;
}

/**
 * FX-delta bot bound to its own state. Returns null when
 * TELEGRAM_BOT_FXDELTA_TOKEN is unset (bot disabled).
 */
export function getFxDeltaTelegramBot(engine: FxDeltaTelegramEngine) {
  const token = process.env.TELEGRAM_BOT_FXDELTA_TOKEN;
  if (!token) return null;
  const registry = getFxDeltaTelegramRegistry();
  void registry.hydrate();
  return createFxDeltaTelegramBot({
    registry,
    subscriptions: getFxDeltaTelegramSubscriptions(),
    engine,
    send: makeFxDeltaTelegramSender(token),
  });
}

/** Test hook — drop singletons between tests. */
export function resetTelegramState(): void {
  registry = null;
  subscriptions = null;
  fxRegistry = null;
  fxSubscriptions = null;
}
