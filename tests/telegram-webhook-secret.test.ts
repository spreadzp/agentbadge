/**
 * SLICE-234-22: forged-update guard on Telegram webhooks.
 * X-Telegram-Bot-Api-Secret-Token must match the configured secret;
 * unset secret = check skipped (dev/test back-compat).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createBstockTelegramBot } from "../src/telegram/bot";
import { createFxDeltaTelegramBot } from "../src/telegram/fxdelta-bot";
import { ChatRegistry } from "../src/telegram/registry";
import { checkWebhookSecret } from "../src/telegram/webhook-secret";

const SECRET = "s3cret-webhook-token";
const UPDATE = { message: { chat: { id: 1, username: "u" }, text: "/start" } };

function post(app: Hono, path: string, secret?: string) {
  return app.request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret !== undefined
        ? { "X-Telegram-Bot-Api-Secret-Token": secret }
        : {}),
    },
    body: JSON.stringify(UPDATE),
  });
}

function bstockApp(webhookSecret?: string) {
  const bot = createBstockTelegramBot({
    registry: new ChatRegistry(),
    send: async () => {},
    engine: { listDeltas: () => [], getEvents: () => [] },
    webhookSecret,
  });
  const app = new Hono();
  app.route("/", bot.routes);
  return { app, path: "/telegram/bstock" };
}

function fxApp(webhookSecret?: string) {
  const bot = createFxDeltaTelegramBot({
    registry: new ChatRegistry(),
    send: async () => {},
    engine: { getAll: () => [], getEvents: () => [] },
    webhookSecret,
  });
  const app = new Hono();
  app.route("/", bot.routes);
  return { app, path: "/telegram/fxdelta" };
}

describe("checkWebhookSecret", () => {
  it("allows when secret unset", () => {
    expect(checkWebhookSecret(undefined, undefined)).toBe(true);
    expect(checkWebhookSecret("anything", undefined)).toBe(true);
  });
  it("rejects missing/wrong header when secret set", () => {
    expect(checkWebhookSecret(undefined, SECRET)).toBe(false);
    expect(checkWebhookSecret("wrong", SECRET)).toBe(false);
    expect(checkWebhookSecret(SECRET + "x", SECRET)).toBe(false);
  });
  it("accepts exact match (timing-safe)", () => {
    expect(checkWebhookSecret(SECRET, SECRET)).toBe(true);
  });
});

describe.each([
  ["bstock", bstockApp],
  ["fxdelta", fxApp],
])("webhook %s", (_name, make) => {
  it("401 without header when secret configured", async () => {
    const { app, path } = make(SECRET);
    expect((await post(app, path)).status).toBe(401);
  });
  it("401 with wrong secret", async () => {
    const { app, path } = make(SECRET);
    expect((await post(app, path, "forged")).status).toBe(401);
  });
  it("200 with correct secret", async () => {
    const { app, path } = make(SECRET);
    expect((await post(app, path, SECRET)).status).toBe(200);
  });
  it("200 without header when secret unset (back-compat)", async () => {
    const { app, path } = make(undefined);
    expect((await post(app, path)).status).toBe(200);
  });
});
