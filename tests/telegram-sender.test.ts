import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  escHtml,
  sendTelegramMessage,
  telegramFromEnv,
} from "../src/server/lib/notify/telegram";

describe("Telegram sender — SLICE-203-12", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("escHtml escapes &, <, >", () => {
    expect(escHtml(`a<b>&c>"x"`)).toBe("a&lt;b&gt;&amp;c&gt;\"x\"");
  });

  it("telegramFromEnv returns undefined without creds", () => {
    expect(telegramFromEnv()).toBeUndefined();
  });

  it("telegramFromEnv returns config with both vars", () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    process.env.TELEGRAM_CHAT_ID = "42";
    expect(telegramFromEnv()).toEqual({ token: "tok", chatId: "42" });
  });

  it("sendTelegramMessage posts sendMessage with parse_mode HTML", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 7 } }),
    });
    globalThis.fetch = fetchMock as never;

    const id = await sendTelegramMessage("<b>hi</b>", {
      token: "tok",
      chatId: "42",
    });

    expect(id).toBe(7);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottok/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      chat_id: "42",
      text: "<b>hi</b>",
      parse_mode: "HTML",
    });
  });

  it("throws with API description when ok=false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, description: "chat not found" }),
    }) as never;

    await expect(
      sendTelegramMessage("x", { token: "t", chatId: "1" }),
    ).rejects.toThrow("chat not found");
  });

  it("throws when fetch rejects (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("EAI_AGAIN")) as never;
    await expect(
      sendTelegramMessage("x", { token: "t", chatId: "1" }),
    ).rejects.toThrow("EAI_AGAIN");
  });
});
