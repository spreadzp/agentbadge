/**
 * SLICE-191-7: FX-delta Telegram bot — batched crossing alerts
 * (1/min), hourly digest (top-3, no dup of just-sent alerts — AC3),
 * chat_id ↔ username registry, DM subscription gating.
 * Port of bstock-telegram.test.ts.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type {
  FxDeltaView,
  FxDeltaEvent,
} from "../src/server/lib/fx-delta";
import {
  formatAlert,
  formatEvent,
  buildDigest,
} from "../src/telegram/fxdelta-format";
import { ChatRegistry } from "../src/telegram/registry";
import { TelegramSubscriptions } from "../src/telegram/subscriptions";
import { createFxDeltaTelegramBot } from "../src/telegram/fxdelta-bot";

const view = (over: Partial<FxDeltaView> = {}): FxDeltaView => ({
  corridor: "USDT-NGN",
  fiat: "NGN",
  chainRate: 1520.5,
  fxRefRate: 1510.2,
  deltaPct: 0.682,
  phase: "open",
  frozen: false,
  stale: false,
  thin: false,
  inAlert: true,
  oracleLagPct: 0.03,
  tvlUsd: 197110,
  lastUpdateMs: 1000,
  ...over,
});

function setup(views: FxDeltaView[], events: FxDeltaEvent[] = []) {
  const registry = new ChatRegistry();
  const subs = new TelegramSubscriptions(registry);
  const sent: { chatId: number; text: string }[] = [];
  const bot = createFxDeltaTelegramBot({
    registry,
    subscriptions: subs,
    engine: { getAll: () => views, getEvents: () => events },
    send: async (chatId, text) => {
      sent.push({ chatId, text });
    },
  });
  const app = new Hono().route("/", bot.routes);
  const post = (body: unknown) =>
    app.request("/telegram/fxdelta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { registry, subs, sent, bot, post };
}

describe("formatting", () => {
  it("formats a corridor alert line", () => {
    expect(formatAlert(view())).toBe(
      "⚡ USDT-NGN 1520.5 (onchain) vs 1510.2 (FX ref) | Delta: +0.68% | phase: open",
    );
  });

  it("marks frozen and stale", () => {
    const line = formatAlert(view({ frozen: true, stale: true }));
    expect(line).toContain("❄ frozen");
    expect(line).toContain("⏸ stale");
  });

  it("formats engine events", () => {
    const e: FxDeltaEvent = {
      type: "alert",
      corridor: "USDT-BRL",
      msg: "crossed 0.5%",
      atMs: 1,
    };
    expect(formatEvent(e)).toContain("USDT-BRL");
    expect(formatEvent(e)).toContain("crossed 0.5%");
  });

  it("digest ranks top-3 non-thin by |delta| and counts alerts", () => {
    const text = buildDigest(
      [
        view({ corridor: "A", deltaPct: 0.9, inAlert: false }),
        view({ corridor: "B", deltaPct: -1.5, inAlert: false }),
        view({ corridor: "C", deltaPct: 0.4, inAlert: false }),
        view({ corridor: "D", deltaPct: 2.0, thin: true }),
      ],
      { alertCount: 2 },
    );
    const bIdx = text.indexOf("B:");
    const aIdx = text.indexOf("A:");
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeGreaterThan(bIdx);
    expect(text).not.toContain("D:"); // thin excluded
    expect(text).toContain("2 alerts");
  });
});

describe("webhook /telegram/fxdelta", () => {
  it("registers chat_id ↔ username on /start", async () => {
    const { registry, post } = setup([]);
    const res = await post({
      message: { chat: { id: 777, username: "carol" }, text: "/start" },
    });
    expect(res.status).toBe(200);
    expect(registry.findByUsername("carol")).toBe(777);
  });

  it("/USDT-NGN shorthand returns that corridor", async () => {
    const { sent, post } = setup([view()]);
    await post({
      message: { chat: { id: 1, username: "u" }, text: "/USDT-NGN" },
    });
    expect(sent[0].text).toContain("USDT-NGN");
    expect(sent[0].text).toContain("+0.68%");
  });

  it("ignores non-message updates", async () => {
    const { post } = setup([]);
    const res = await post({ channel_post: {} });
    expect(res.status).toBe(200);
  });
});

describe("alertTick", () => {
  it("batches in-alert corridors + new events to subscribed chats", async () => {
    const events: FxDeltaEvent[] = [
      { type: "alert", corridor: "USDT-NGN", msg: "crossed", atMs: 1 },
    ];
    const { subs, sent, bot, post } = setup(
      [view(), view({ corridor: "USDT-KES", inAlert: false })],
      events,
    );
    await post({ message: { chat: { id: 5, username: "d" }, text: "/start" } });
    subs.subscribe("agent1", "d");
    sent.length = 0;

    await bot.alertTick();
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(5);
    expect(sent[0].text).toContain("USDT-NGN");
    expect(sent[0].text).toContain("crossed");
    expect(sent[0].text).not.toContain("USDT-KES");
  });

  it("sends nothing when no alerts and no new events", async () => {
    const { subs, sent, bot, post } = setup([
      view({ inAlert: false }),
    ]);
    await post({ message: { chat: { id: 5, username: "d" }, text: "/start" } });
    subs.subscribe("agent1", "d");
    sent.length = 0;
    await bot.alertTick();
    expect(sent).toHaveLength(0);
  });
});

describe("digestTick (AC3)", () => {
  it("digest skips corridors whose alert was just pushed", async () => {
    const { sent, bot, post } = setup([
      view(), // USDT-NGN inAlert
      view({ corridor: "USDT-BRL", deltaPct: -0.9, inAlert: false }),
    ]);
    await post({ message: { chat: { id: 5, username: "d" }, text: "/start" } });
    await post({ message: { chat: { id: 5, username: "d" }, text: "/hourly" } });
    sent.length = 0;

    await bot.alertTick(); // pushes USDT-NGN alert
    sent.length = 0;
    await bot.digestTick();

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("USDT-BRL"); // still ranked
    expect(sent[0].text).not.toMatch(/USDT-NGN:/); // just-alerted skipped
    expect(sent[0].text).toContain("1 alerts");
  });
});
