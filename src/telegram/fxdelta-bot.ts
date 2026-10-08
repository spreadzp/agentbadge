/**
 * FX-delta Telegram bot (EPIC-191, SLICE-191-7, D-191-13).
 * Port of bstock bot (141-9) with corridor semantics:
 *
 * - Webhook route POST /telegram/fxdelta — registers chat_id ↔ username
 *   on first message (DM model, Q30), pull-model commands.
 * - alertTick(): 1/min cadence — batches hysteresis-crossing deltas +
 *   new events into ONE message per chat. Tracks pushed corridors so
 *   the digest never re-sends a live alert (AC3).
 * - digestTick(): ~1h cron — top-3 |delta| movers + phase + alert count
 *   to /hourly opt-in chats.
 */

import { Hono } from "hono";
import type { FxDeltaView, FxDeltaEvent } from "../server/lib/fx-delta";
import {
  formatAlert,
  formatEvent,
  buildDigest,
} from "./fxdelta-format";
import { ChatRegistry } from "./registry";
import type { TelegramSubscriptions } from "./subscriptions";

export interface FxDeltaTelegramEngine {
  getAll(): FxDeltaView[];
  getEvents(): FxDeltaEvent[];
}

export type TelegramSend = (chatId: number, text: string) => Promise<void>;

export interface FxDeltaTelegramBotOptions {
  registry: ChatRegistry;
  engine: FxDeltaTelegramEngine;
  /** Injectable sender — production default hits the Bot API. */
  send: TelegramSend;
  /**
   * Subscription store (DM model). When provided, alerts go ONLY to
   * subscribed chat_ids; when absent, all registered chats receive
   * them (test back-compat).
   */
  subscriptions?: TelegramSubscriptions;
}

interface TgMessage {
  chat?: { id?: number; username?: string };
  text?: string;
}

interface TgUpdate {
  message?: TgMessage;
}

/** Default sender — Telegram Bot API sendMessage. */
export function makeFxDeltaTelegramSender(botToken: string): TelegramSend {
  return async (chatId, text) => {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  };
}

export function createFxDeltaTelegramBot(opts: FxDeltaTelegramBotOptions) {
  const { registry, engine, send, subscriptions } = opts;
  let lastEventCount = 0;
  /** Corridors pushed since last digestTick — digest skips them (AC3). */
  let alertedSinceDigest = new Set<string>();
  let alertsSinceDigest = 0;

  /** Delivery targets: subscribed chats only when subscriptions exist. */
  function targets(): number[] {
    if (!subscriptions) return registry.list().map((c) => c.chatId);
    return subscriptions.subscribedChatIds();
  }

  const routes = new Hono();

  /** Chats that opted into the hourly digest via /hourly. */
  const hourlyChats = new Set<number>();

  const HELP =
    "📈 Celo FX Delta Tracker — on-demand commands:\n" +
    "/<CORRIDOR> — delta for a corridor (e.g. /USDT-NGN)\n" +
    "/deltas — corridors currently in alert\n" +
    "/digest — top movers now\n" +
    "/hourly — toggle hourly digest on/off\n" +
    "/help — this message";

  routes.post("/telegram/fxdelta", async (c) => {
    const update = (await c.req.json()) as TgUpdate;
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (chatId === undefined) return c.json({ ok: true });

    const username = msg?.chat?.username ?? String(chatId);
    await registry.register(chatId, username);

    const m = /^\/(\S+?)(?:@\w+)?(?:\s+(\S+))?$/.exec(
      msg?.text?.trim() ?? "",
    );
    const cmd = m?.[1]?.toUpperCase();

    if (cmd === "START" || cmd === "HELP") {
      await send(chatId, HELP);
    } else if (cmd === "DELTAS") {
      const hot = engine.getAll().filter((d) => d.inAlert);
      await send(
        chatId,
        hot.length
          ? hot.map(formatAlert).join("\n")
          : "No corridors in alert right now.",
      );
    } else if (cmd === "DIGEST") {
      await send(
        chatId,
        buildDigest(engine.getAll(), {
          alertCount: alertsSinceDigest,
          skipCorridors: alertedSinceDigest,
        }),
      );
    } else if (cmd === "HOURLY") {
      if (hourlyChats.has(chatId)) {
        hourlyChats.delete(chatId);
        await send(chatId, "⏸ Hourly digest off.");
      } else {
        hourlyChats.add(chatId);
        await send(chatId, "⏰ Hourly digest on — summary every hour.");
      }
    } else if (cmd) {
      // /<CORRIDOR> shorthand — e.g. /USDT-NGN shows that corridor.
      const v = engine.getAll().find((d) => d.corridor === cmd);
      if (v) await send(chatId, formatAlert(v));
      else await send(chatId, "Unknown command or corridor — try /help");
    }
    return c.json({ ok: true });
  });

  /** 1/min cadence: batch crossing alerts + new events → one msg/chat. */
  async function alertTick(): Promise<void> {
    const lines: string[] = [];
    const pushed = new Set<string>();
    for (const v of engine.getAll()) {
      if (v.inAlert) {
        lines.push(formatAlert(v));
        pushed.add(v.corridor);
      }
    }
    const events = engine.getEvents();
    for (const e of events.slice(lastEventCount)) {
      lines.push(formatEvent(e));
    }
    lastEventCount = events.length;
    if (lines.length === 0) return;

    for (const c of pushed) alertedSinceDigest.add(c);
    alertsSinceDigest += pushed.size;
    const text = lines.join("\n");
    for (const chatId of targets()) {
      await send(chatId, text);
    }
  }

  /** ~1h cron: top-3 digest to /hourly opt-ins; resets the dedup set. */
  async function digestTick(): Promise<void> {
    if (hourlyChats.size === 0) {
      alertedSinceDigest = new Set<string>();
      alertsSinceDigest = 0;
      return;
    }
    const text = buildDigest(engine.getAll(), {
      alertCount: alertsSinceDigest,
      skipCorridors: alertedSinceDigest,
    });
    for (const chatId of hourlyChats) {
      await send(chatId, text);
    }
    alertedSinceDigest = new Set<string>();
    alertsSinceDigest = 0;
  }

  return { routes, alertTick, digestTick };
}
