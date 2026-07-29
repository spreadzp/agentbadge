import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  formatFeedbackMessage,
  sendDiscordMessage,
  sendTelegramMessage,
} from "../src/server/services/contact.service";

const mockFetch = vi.fn();

describe("Contact Service", () => {
  beforeEach(() => {
    process.env.DISCORD_WEBHOOK_URL =
      "https://discord.com/api/webhooks/test/test-token";
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat-id";
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 204, text: () => Promise.resolve("") });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.restoreAllMocks();
  });

  describe("formatFeedbackMessage", () => {
    it("formats message with all fields", () => {
      const result = formatFeedbackMessage({
        channel: "discord",
        message: "Hello team!",
        contactInfo: "user#1234",
        fileName: "screenshot.png",
      });

      expect(result).toContain("📨 New Feedback (DISCORD)");
      expect(result).toContain("Hello team!");
      expect(result).toContain("Contact: user#1234");
      expect(result).toContain("Attachment: screenshot.png");
      expect(result).toContain("Time:");
    });

    it("formats message with only message body", () => {
      const result = formatFeedbackMessage({
        channel: "telegram",
        message: "Just saying hi",
      });

      expect(result).toContain("📨 New Feedback (TELEGRAM)");
      expect(result).toContain("Just saying hi");
      expect(result).not.toContain("Contact:");
      expect(result).not.toContain("Attachment:");
    });
  });

  describe("sendDiscordMessage", () => {
    it("sends JSON message to Discord webhook URL", async () => {
      await sendDiscordMessage({ message: "Test feedback" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://discord.com/api/webhooks/test/test-token");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const body = JSON.parse(init?.body as string);
      expect(body.content).toContain("Test feedback");
      expect(body.content).toContain("📨 New Feedback (DISCORD)");
    });

    it("includes contactInfo in message when provided", async () => {
      await sendDiscordMessage({ message: "Hello", contactInfo: "user@email.com" });

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.content).toContain("Contact: user@email.com");
    });

    it("sends multipart form-data when file is provided", async () => {
      await sendDiscordMessage({
        message: "See attached",
        fileName: "report.txt",
        fileContent: Buffer.from("file contents").toString("base64"),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://discord.com/api/webhooks/test/test-token");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
    });

    it("throws when DISCORD_WEBHOOK_URL is not set", async () => {
      delete process.env.DISCORD_WEBHOOK_URL;

      await expect(sendDiscordMessage({ message: "test" })).rejects.toThrow(
        "DISCORD_WEBHOOK_URL not configured"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws on Discord API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      });

      await expect(sendDiscordMessage({ message: "test" })).rejects.toThrow(
        "Discord API error: 429"
      );
    });
  });

  describe("sendTelegramMessage", () => {
    it("sends message to Telegram Bot API", async () => {
      await sendTelegramMessage({ message: "Test feedback" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      const body = JSON.parse(init?.body as string);
      expect(body.chat_id).toBe("test-chat-id");
      expect(body.parse_mode).toBe("HTML");
      expect(body.text).toContain("Test feedback");
      expect(body.text).toContain("📨 New Feedback (TELEGRAM)");
    });

    it("includes contactInfo in message when provided", async () => {
      await sendTelegramMessage({ message: "Hello", contactInfo: "@user" });

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.text).toContain("Contact: @user");
    });

    it("throws when TELEGRAM_BOT_TOKEN is not set", async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;

      await expect(sendTelegramMessage({ message: "test" })).rejects.toThrow(
        "TELEGRAM_BOT_TOKEN not configured"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws when TELEGRAM_CHAT_ID is not set", async () => {
      delete process.env.TELEGRAM_CHAT_ID;

      await expect(sendTelegramMessage({ message: "test" })).rejects.toThrow(
        "TELEGRAM_CHAT_ID not configured"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws on Telegram API error with response body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request: chat not found"),
      });

      await expect(sendTelegramMessage({ message: "test" })).rejects.toThrow(
        "Telegram API error: 400 — Bad Request: chat not found"
      );
    });
  });
});
