/**
 * SLICE-141-9: Telegram bot — batched delta alerts (1/min cadence),
 * hourly digest + /digest command, chat_id ↔ username registry.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { DeltaView, DeltaEvent } from "@agentbadge/bstock-tracker";
import {
  formatAlert,
  formatEvent,
  buildDigest,
} from "../src/telegram/format";
import { ChatRegistry } from "../src/telegram/registry";
import { createBstockTelegramBot } from "../src/telegram/bot";

const view = (over: Partial<DeltaView> = {}): DeltaView => ({
  symbol: "AAPLB",
  underlying: "AAPL",
  multiplier: 1,
  bStockPrice: 182.5,
  underlyingPrice: 181.2,
  deltaPct: 0.7174,
  phase: "O",
  stale: false,
  inAlert: true,
  lastUpdateMs: 1000,
  ...over,
});

describe("formatting", () => {
  it("formats a delta alert line", () => {
    expect(formatAlert(view())).toBe(
      "⚡ AAPLB 182.50 (Binance) vs 181.20 (NASDAQ) | Delta: +0.72% | phase: O",
    );
  });

  it("formats negative delta", () => {
    expect(formatAlert(view({ deltaPct: -1.234 }))).toContain("-1.23%");
  });

  it("formats tradingStatus/tradability events", () => {
    const ev: DeltaEvent = {
      type: "tradingStatus",
      symbol: "AAPLB",
      status: "HALT",
      atMs: 1,
    };
    expect(formatEvent(ev)).toContain("AAPLB");
    expect(formatEvent(ev)).toContain("HALT");
  });

  it("digest summarizes all symbols", () => {
    const text = buildDigest([
      view(),
      view({ symbol: "TSLAB", underlying: "TSLA", deltaPct: -0.3, inAlert: false }),
    ]);
    expect(text).toContain("AAPLB");
    expect(text).toContain("TSLAB");
    expect(text).toContain("+0.72%");
  });
});

describe("ChatRegistry", () => {
  it("remembers chat_id ↔ username", () => {
    const reg = new ChatRegistry();
    reg.register(123, "@alice");
    reg.register(456, "@bob");
    expect(reg.list()).toEqual([
      { chatId: 123, username: "@alice" },
      { chatId: 456, username: "@bob" },
    ]);
  });
});

describe("bot: alert tick batching", () => {
  it("batches all in-alert deltas into ONE message per chat", async () => {
    const sent: { chatId: number; text: string }[] = [];
    const reg = new ChatRegistry();
    reg.register(123, "@alice");
    const bot = createBstockTelegramBot({
      registry: reg,
      send: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      engine: {
        listDeltas: () => [view(), view({ symbol: "TSLAB", underlying: "TSLA" })],
        getEvents: () => [],
      },
    });
    await bot.alertTick();
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(123);
    expect(sent[0].text).toContain("AAPLB");
    expect(sent[0].text).toContain("TSLAB");
  });

  it("sends nothing when no alerts", async () => {
    const sent: unknown[] = [];
    const reg = new ChatRegistry();
    reg.register(123, "@alice");
    const bot = createBstockTelegramBot({
      registry: reg,
      send: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      engine: {
        listDeltas: () => [view({ inAlert: false })],
        getEvents: () => [],
      },
    });
    await bot.alertTick();
    expect(sent).toHaveLength(0);
  });
});

describe("webhook", () => {
  it("registers chat_id ↔ username on first message", async () => {
    const reg = new ChatRegistry();
    const bot = createBstockTelegramBot({
      registry: reg,
      send: async () => {},
      engine: { listDeltas: () => [], getEvents: () => [] },
    });
    const app = new Hono();
    app.route("/", bot.routes);
    const res = await app.request("/telegram/bstock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { chat: { id: 777, username: "carol" }, text: "hi" },
      }),
    });
    expect(res.status).toBe(200);
    expect(reg.list()).toEqual([{ chatId: 777, username: "carol" }]);
  });

  it("/digest replies with the digest to that chat", async () => {
    const sent: { chatId: number; text: string }[] = [];
    const reg = new ChatRegistry();
    const bot = createBstockTelegramBot({
      registry: reg,
      send: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      engine: { listDeltas: () => [view()], getEvents: () => [] },
    });
    const app = new Hono();
    app.route("/", bot.routes);
    await app.request("/telegram/bstock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { chat: { id: 777, username: "carol" }, text: "/digest" },
      }),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(777);
    expect(sent[0].text).toContain("AAPLB");
  });

  const postCmd = (
    app: Hono,
    text: string,
    chatId = 777,
    username = "carol",
  ) =>
    app.request("/telegram/bstock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { chat: { id: chatId, username }, text },
      }),
    });

  const makeApp = (views: DeltaView[]) => {
    const sent: { chatId: number; text: string }[] = [];
    const bot = createBstockTelegramBot({
      registry: new ChatRegistry(),
      send: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      engine: { listDeltas: () => views, getEvents: () => [] },
    });
    const app = new Hono();
    app.route("/", bot.routes);
    return { app, sent };
  };

  it("/delta <SYM> replies with that symbol's delta", async () => {
    const { app, sent } = makeApp([view()]);
    await postCmd(app, "/delta AAPLB");
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("AAPLB");
    expect(sent[0].text).toContain("+0.72%");
  });

  it("/delta without arg replies with usage", async () => {
    const { app, sent } = makeApp([view()]);
    await postCmd(app, "/delta");
    expect(sent[0].text).toContain("Usage: /delta");
  });

  it("/delta unknown symbol replies not tracked", async () => {
    const { app, sent } = makeApp([view()]);
    await postCmd(app, "/delta ZZZZ");
    expect(sent[0].text).toContain("not tracked");
  });

  it("/deltas lists only in-alert symbols", async () => {
    const { app, sent } = makeApp([
      view(),
      view({ symbol: "TSLAB", underlying: "TSLA", inAlert: false }),
    ]);
    await postCmd(app, "/deltas");
    expect(sent[0].text).toContain("AAPLB");
    expect(sent[0].text).not.toContain("TSLAB");
  });

  it("/deltas with no alerts says so", async () => {
    const { app, sent } = makeApp([view({ inAlert: false })]);
    await postCmd(app, "/deltas");
    expect(sent[0].text).toContain("No symbols in alert");
  });

  it("/start replies with help", async () => {
    const { app, sent } = makeApp([]);
    await postCmd(app, "/start");
    expect(sent[0].text).toContain("/delta");
    expect(sent[0].text).toContain("/digest");
  });

  it("plain text sends nothing", async () => {
    const { app, sent } = makeApp([view()]);
    await postCmd(app, "hello");
    expect(sent).toHaveLength(0);
  });

  it("/<TICKER> shorthand replies with that symbol's delta", async () => {
    const { app, sent } = makeApp([view()]);
    await postCmd(app, "/AAPLB");
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("AAPLB");
    expect(sent[0].text).toContain("+0.72%");
  });

  it("/<UNKNOWN> replies with help hint", async () => {
    const { app, sent } = makeApp([view()]);
    await postCmd(app, "/foobar");
    expect(sent[0].text).toContain("/help");
  });

  it("stale view shows market closed flag", async () => {
    const { app, sent } = makeApp([view({ stale: true })]);
    await postCmd(app, "/AAPLB");
    expect(sent[0].text).toContain("market closed");
  });

  it("/hourly opts chat into digestTick, toggles off", async () => {
    const sent2: { chatId: number; text: string }[] = [];
    const b = createBstockTelegramBot({
      registry: new ChatRegistry(),
      send: async (chatId, text) => {
        sent2.push({ chatId, text });
      },
      engine: { listDeltas: () => [view()], getEvents: () => [] },
    });
    const app2 = new Hono();
    app2.route("/", b.routes);

    // no opt-in → digestTick silent
    await b.digestTick();
    expect(sent2).toHaveLength(0);

    // opt in → digestTick delivers
    await postCmd(app2, "/hourly");
    expect(sent2[0].text).toContain("Hourly digest on");
    await b.digestTick();
    expect(sent2).toHaveLength(2);
    expect(sent2[1].text).toContain("AAPLB");

    // toggle off → silent again
    await postCmd(app2, "/hourly");
    expect(sent2[2].text).toContain("off");
    await b.digestTick();
    expect(sent2).toHaveLength(3);
  });
});
