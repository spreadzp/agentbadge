import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  escHtml,
  sendTelegramDocument,
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

describe("sendTelegramDocument — SLICE-217-3", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const formEntries = async (form: FormData) => {
    const out: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      out[k] = typeof v === "string" ? v : `[file:${(v as File).name}]`;
    }
    return out;
  };

  it("posts multipart sendDocument with filename + escaped caption", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });
    globalThis.fetch = fetchMock as never;

    const id = await sendTelegramDocument(
      { token: "tok", chatId: "-100999" },
      {
        filename: "archive-2026-11-09.jsonl.gz",
        data: new TextEncoder().encode("gzip-bytes"),
        caption: "Week <b>45</b> & done",
      },
    );

    expect(id).toBe(42);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottok/sendDocument");
    const form = (init as RequestInit).body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const entries = await formEntries(form);
    expect(entries["chat_id"]).toBe("-100999");
    expect(entries["document"]).toBe("[file:archive-2026-11-09.jsonl.gz]");
    // caption is escHtml'd — literal <b> must not reach TG as markup
    expect(entries["caption"]).toBe("Week &lt;b&gt;45&lt;/b&gt; &amp; done");
    expect(entries["parse_mode"]).toBe("HTML");
  });

  it("sends document bytes through Blob unchanged", async () => {
    const payload = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // gzip magic
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    });
    globalThis.fetch = fetchMock as never;

    await sendTelegramDocument(
      { token: "t", chatId: "1" },
      { filename: "a.gz", data: payload },
    );

    const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    const file = form.get("document") as File;
    expect(file.name).toBe("a.gz");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(payload);
  });

  it("accepts string data and mimeType", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 2 } }),
    });
    globalThis.fetch = fetchMock as never;

    await sendTelegramDocument(
      { token: "t", chatId: "1" },
      { filename: "a.jsonl", data: '{"a":1}\n', mimeType: "application/jsonl" },
    );

    const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    const file = form.get("document") as File;
    expect(file.type).toBe("application/jsonl");
    expect(await file.text()).toBe('{"a":1}\n');
  });

  it("omits caption fields when caption absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 3 } }),
    });
    globalThis.fetch = fetchMock as never;

    await sendTelegramDocument(
      { token: "t", chatId: "1" },
      { filename: "a.bin", data: "x" },
    );

    const form = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(form.get("caption")).toBeNull();
    expect(form.get("parse_mode")).toBeNull();
  });

  it("throws with API description when ok=false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: false,
        description: "document too large",
      }),
    }) as never;

    await expect(
      sendTelegramDocument(
        { token: "t", chatId: "1" },
        { filename: "big.bin", data: "x" },
      ),
    ).rejects.toThrow("document too large");
  });
});
