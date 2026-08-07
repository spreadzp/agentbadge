import { describe, it, expect, beforeEach, vi } from "vitest";
import { formatWorkRequestNotification, notifyWorkRequest } from "../src/server/services/work-request-notification";
import { workRequestStore } from "../src/server/services/work-request-store";
import type { WorkRequestRecord } from "../src/server/services/work-request-store";

function mockRecord(overrides?: Partial<WorkRequestRecord>): WorkRequestRecord {
  return {
    id: "wr-test-1",
    status: "received",
    request: {
      title: "Build an MCP server",
      summary: "We need an MCP server for our REST API.",
      requirements: ["TypeScript", "Hedera SDK"],
    },
    preferred_contact: { channel: "telegram" },
    created_at: "2026-08-07T12:00:00.000Z",
    updated_at: "2026-08-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("SLICE-46-10: Human notification — Telegram/Discord forwarding", () => {
  describe("formatWorkRequestNotification", () => {
    it("includes title", () => {
      const msg = formatWorkRequestNotification(mockRecord());
      expect(msg).toContain("Build an MCP server");
    });

    it("includes summary (truncated)", () => {
      const msg = formatWorkRequestNotification(mockRecord());
      expect(msg).toContain("We need an MCP server for our REST API.");
    });

    it("includes link to /work-requests/{id}", () => {
      const msg = formatWorkRequestNotification(mockRecord());
      expect(msg).toContain("/work-requests/wr-test-1");
    });

    it("includes requirements", () => {
      const msg = formatWorkRequestNotification(mockRecord());
      expect(msg).toContain("TypeScript");
      expect(msg).toContain("Hedera SDK");
    });

    it("includes preferred contact channel", () => {
      const msg = formatWorkRequestNotification(mockRecord());
      expect(msg).toContain("telegram");
    });

    it("truncates long summaries to 200 chars + ellipsis", () => {
      const longSummary = "a".repeat(300);
      const msg = formatWorkRequestNotification(
        mockRecord({ request: { title: "Test", summary: longSummary } }),
      );
      // Should contain truncated version with ellipsis
      expect(msg).toContain("…");
      expect(msg).not.toContain("a".repeat(300));
    });

    it("works without requirements", () => {
      const msg = formatWorkRequestNotification(
        mockRecord({ request: { title: "Test", summary: "Short" } }),
      );
      expect(msg).toContain("Test");
      expect(msg).toContain("Short");
    });

    it("works without preferred_contact", () => {
      const msg = formatWorkRequestNotification(
        mockRecord({ preferred_contact: undefined }),
      );
      expect(msg).toContain("Build an MCP server");
      expect(msg).not.toContain("Preferred contact");
    });
  });

  describe("notifyWorkRequest", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("does not throw when no env vars are set", async () => {
      const origDiscord = process.env.DISCORD_WEBHOOK_URL;
      const origTgToken = process.env.TELEGRAM_BOT_TOKEN;
      const origTgChat = process.env.TELEGRAM_CHAT_ID;
      delete process.env.DISCORD_WEBHOOK_URL;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;

      await expect(notifyWorkRequest(mockRecord())).resolves.not.toThrow();

      if (origDiscord) process.env.DISCORD_WEBHOOK_URL = origDiscord;
      if (origTgToken) process.env.TELEGRAM_BOT_TOKEN = origTgToken;
      if (origTgChat) process.env.TELEGRAM_CHAT_ID = origTgChat;
    });

    it("attempts Discord notification when DISCORD_WEBHOOK_URL is set", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      await notifyWorkRequest(mockRecord());

      expect(fetchSpy).toHaveBeenCalled();
      const [url] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain("discord.com");

      delete process.env.DISCORD_WEBHOOK_URL;
      fetchSpy.mockRestore();
    });

    it("attempts Telegram notification when TELEGRAM_BOT_TOKEN is set", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.TELEGRAM_CHAT_ID = "test-chat";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      await notifyWorkRequest(mockRecord());

      const calls = fetchSpy.mock.calls;
      const tgCall = calls.find((c) => String(c[0]).includes("api.telegram.org"));
      expect(tgCall).toBeDefined();

      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
      fetchSpy.mockRestore();
    });

    it("failed notifications don't throw — errors logged", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
      process.env.TELEGRAM_BOT_TOKEN = "test-token";
      process.env.TELEGRAM_CHAT_ID = "test-chat";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });

      await expect(notifyWorkRequest(mockRecord())).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalled();

      delete process.env.DISCORD_WEBHOOK_URL;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
      fetchSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe("POST /api/work-requests triggers notification", () => {
    beforeEach(() => {
      workRequestStore.clear();
      vi.restoreAllMocks();
    });

    it("notification is fire-and-forget — POST still returns 202 even if notification fails", async () => {
      const { makeTestApp, setupMockEnv } = await import("./e2e/helpers");
      setupMockEnv();
      const app = makeTestApp();

      // Mock fetch to fail for notifications
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });

      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";

      const res = await app.request("/api/work-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: { title: "Test notification", summary: "Should not block" },
        }),
      });

      expect(res.status).toBe(202);

      delete process.env.DISCORD_WEBHOOK_URL;
      fetchSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
