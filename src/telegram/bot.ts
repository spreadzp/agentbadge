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
  const { registry, engine, send } = opts;
  let lastEventCount = 0;

  const routes = new Hono();

  routes.post("/telegram/bstock", async (c) => {
    const update = (await c.req.json()) as TgUpdate;
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (chatId === undefined) return c.json({ ok: true });

    const username = msg?.chat?.username ?? String(chatId);
    registry.register(chatId, username);

    if (msg?.text?.trim() === "/digest") {
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
    for (const { chatId } of registry.list()) {
      await send(chatId, text);
    }
  }

  /** ~1h cron: digest of all tickers to every registered chat. */
  async function digestTick(): Promise<void> {
    const text = buildDigest(engine.listDeltas());
    for (const { chatId } of registry.list()) {
      await send(chatId, text);
    }
  }

  return { routes, alertTick, digestTick };
}
