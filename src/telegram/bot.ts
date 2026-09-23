/**
 * bStock Telegram bot (EPIC-141, SLICE-141-9).
 *
 * - Webhook route POST /telegram/bstock — registers chat_id ↔ username
 *   on first message (DM model, Q30), handles /digest on demand.
 * - alertTick(): 1/min cadence — reads engine snapshot, batches all
 *   in-alert deltas + new events into ONE message per chat.
 * - digestTick(): ~1h cron — summary of all tickers to every chat.
 *
 * Telegram is the free channel — deliberately batched/minute, never
 * real-time (real-time stays behind the paid MCP tier).
 */

import { Hono } from "hono";
import type { DeltaView, DeltaEvent } from "@agentbadge/bstock-tracker";
import { formatAlert, formatEvent, buildDigest } from "./format";
import { ChatRegistry } from "./registry";
import type { TelegramSubscriptions } from "./subscriptions";

export interface BstockTelegramEngine {
  listDeltas(): DeltaView[];
  getEvents(): DeltaEvent[];
}

export type TelegramSend = (chatId: number, text: string) => Promise<void>;

export interface BstockTelegramBotOptions {
  registry: ChatRegistry;
  engine: BstockTelegramEngine;
  /** Injectable sender — production default hits the Bot API. */
  send: TelegramSend;
  /**
   * Subscription store (141-10). When provided, alerts/digests go ONLY
   * to subscribed chat_ids; when absent, all registered chats receive
   * them (back-compat with 141-9 tests).
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
export function makeTelegramSender(botToken: string): TelegramSend {
  return async (chatId, text) => {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  };
}

export function createBstockTelegramBot(opts: BstockTelegramBotOptions) {
  const { registry, engine, send, subscriptions } = opts;
  let lastEventCount = 0;

  /** Delivery targets: subscribed chats only when subscriptions exist. */
  function targets(): number[] {
    if (!subscriptions) return registry.list().map((c) => c.chatId);
    return subscriptions.subscribedChatIds();
  }

  const routes = new Hono();

  const HELP =
    "📈 bStock Delta Tracker — on-demand commands:\n" +
    "/delta <SYM> — delta for one symbol (e.g. /delta AAPLB)\n" +
    "/deltas — symbols currently in alert\n" +
    "/digest — all tracked symbols\n" +
    "/help — this message";

  routes.post("/telegram/bstock", async (c) => {
    const update = (await c.req.json()) as TgUpdate;
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (chatId === undefined) return c.json({ ok: true });

    const username = msg?.chat?.username ?? String(chatId);
    registry.register(chatId, username);

    // Pull model: data only on explicit command — no auto-push.
    const m = /^\/(\w+)(?:@\w+)?(?:\s+(\S+))?/.exec(msg?.text?.trim() ?? "");
    const cmd = m?.[1]?.toLowerCase();
    const arg = m?.[2]?.toUpperCase();

    if (cmd === "start" || cmd === "help") {
      await send(chatId, HELP);
    } else if (cmd === "delta") {
      if (!arg) {
        await send(chatId, "Usage: /delta <SYM> — e.g. /delta AAPLB");
      } else {
        const v = engine.listDeltas().find((d) => d.symbol === arg);
        await send(
          chatId,
          v ? formatAlert(v) : `Symbol ${arg} is not tracked.`,
        );
      }
    } else if (cmd === "deltas") {
      const hot = engine.listDeltas().filter((d) => d.inAlert);
      await send(
        chatId,
        hot.length
          ? hot.map(formatAlert).join("\n")
          : "No symbols in alert right now.",
      );
    } else if (cmd === "digest") {
      await send(chatId, buildDigest(engine.listDeltas()));
    }
    return c.json({ ok: true });
  });

  /** 1/min cadence: batch in-alert deltas + new events → one message/chat. */
  async function alertTick(): Promise<void> {
    const lines: string[] = [];
    for (const v of engine.listDeltas()) {
      if (v.inAlert) lines.push(formatAlert(v));
    }
    const events = engine.getEvents();
    for (const e of events.slice(lastEventCount)) {
      lines.push(formatEvent(e));
    }
    lastEventCount = events.length;
    if (lines.length === 0) return;

    const text = lines.join("\n");
    for (const chatId of targets()) {
      await send(chatId, text);
    }
  }

  /** ~1h cron: digest of all tickers to every subscribed chat. */
  async function digestTick(): Promise<void> {
    const text = buildDigest(engine.listDeltas());
    for (const chatId of targets()) {
      await send(chatId, text);
    }
  }

  return { routes, alertTick, digestTick };
}
