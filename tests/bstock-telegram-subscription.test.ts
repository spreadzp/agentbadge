/**
 * SLICE-141-10: Telegram subscription via MCP tools (DM model, Q30).
 * subscribe_telegram / unsubscribe_telegram / get_subscription_status —
 * binding agent-token → username → chat_id; alerts only to subscribers.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createNamespace } from "@agentbadge/mcp";
import { registerBstockTelegramTools } from "@agentbadge/mcp";
import { createNamespaceRoutes } from "../src/server/routes/mcp-namespace";
import { ChatRegistry } from "../src/telegram/registry";
import { TelegramSubscriptions } from "../src/telegram/subscriptions";
import { createBstockTelegramBot } from "../src/telegram/bot";

function setup() {
  const registry = new ChatRegistry();
  const subs = new TelegramSubscriptions(registry);
  const ns = createNamespace("bstock");
  registerBstockTelegramTools({ subscriptions: subs }, ns);
  const app = new Hono<{ Variables: { agentId: string } }>();
  // Simulate bstockAuth: agentId from bearer token.
  app.use("/mcp/bstock/*", async (c, next) => {
    const token = c.req.header("Authorization")?.slice(7) ?? "";
    c.set("agentId", token === "tok-1" ? "agent1" : "agent2");
    await next();
  });
  app.route("/mcp/bstock", createNamespaceRoutes("bstock"));
  return { registry, subs, app };
}

type TestApp = Hono<{ Variables: { agentId: string } }>;

const call = (app: TestApp, tool: string, args: unknown, token = "tok-1") =>
  app.request(`/mcp/bstock/tools/${tool}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

describe("subscribe_telegram", () => {
  it("binds agent → username → chat_id when user wrote to the bot", async () => {
    const { registry, subs, app } = setup();
    registry.register(777, "carol");
    const res = await call(app, "subscribe_telegram", { username: "carol" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isError).toBeFalsy();
    expect(subs.status("agent1")).toEqual({ username: "carol", chatId: 777 });
  });

  it("unknown username → error telling user to /start the bot", async () => {
    const { app } = setup();
    const res = await call(app, "subscribe_telegram", { username: "ghost" });
    const body = await res.json();
    expect(body.isError ?? body.error).toBeTruthy();
    const text = JSON.stringify(body);
    expect(text).toContain("/start");
  });
});

describe("unsubscribe + status", () => {
  it("unsubscribe removes the binding; status reflects it", async () => {
    const { registry, subs, app } = setup();
    registry.register(777, "carol");
    await call(app, "subscribe_telegram", { username: "carol" });
    expect(subs.status("agent1")).toBeTruthy();

    const res = await call(app, "unsubscribe_telegram", {});
    expect(res.status).toBe(200);
    expect(subs.status("agent1")).toBeNull();

    const st = await call(app, "get_subscription_status", {});
    const body = await st.json();
    expect(JSON.stringify(body)).toContain("not subscribed");
  });

  it("status shows username + chat_id when subscribed", async () => {
    const { registry, app } = setup();
    registry.register(777, "carol");
    await call(app, "subscribe_telegram", { username: "carol" });
    const res = await call(app, "get_subscription_status", {});
    const body = await res.json();
    const text = JSON.stringify(body);
    expect(text).toContain("carol");
    expect(text).toContain("777");
  });
});

describe("alert delivery", () => {
  it("alerts go ONLY to subscribed chat_ids", async () => {
    const sent: number[] = [];
    const registry = new ChatRegistry();
    const subs = new TelegramSubscriptions(registry);
    registry.register(111, "subscribed");
    registry.register(222, "lurker");
    subs.subscribe("agent1", "subscribed");

    const bot = createBstockTelegramBot({
      registry,
      subscriptions: subs,
      send: async (chatId) => {
        sent.push(chatId);
      },
      engine: {
        listDeltas: () => [
          {
            symbol: "AAPLB",
            underlying: "AAPL",
            multiplier: 1,
            bStockPrice: 182.5,
            underlyingPrice: 181.2,
            deltaPct: 0.72,
            phase: "O",
            stale: false,
            inAlert: true,
            lastUpdateMs: 1,
          },
        ],
        getEvents: () => [],
      },
    });
    await bot.alertTick();
    expect(sent).toEqual([111]);
  });
});
