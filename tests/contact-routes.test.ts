import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

vi.mock("../src/server/services/contact.service", () => ({
  sendDiscordMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));

import { sendDiscordMessage, sendTelegramMessage } from "../src/server/services/contact.service";
import { contactRoutes, resetRateLimit } from "../src/server/routes/contact";
import { contactPage, contactSuccessFragment, contactErrorFragment } from "../src/views/contact-page";

const mockedSendDiscord = vi.mocked(sendDiscordMessage);
const mockedSendTelegram = vi.mocked(sendTelegramMessage);

describe("Contact Routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    resetRateLimit();
    app = new Hono();
    app.route("/", contactRoutes);
    mockedSendDiscord.mockResolvedValue(undefined);
    mockedSendTelegram.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET /contact", () => {
    it("returns 200 with HTML form", async () => {
      const res = await app.request("/contact");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<form");
      expect(html).toContain('hx-post="/contact"');
      expect(html).toContain('data-channel="discord"');
      expect(html).toContain('data-channel="telegram"');
      expect(html).toContain('name="message"');
      expect(html).toContain('maxlength="4096"');
    });

    it("includes SVG icons for Discord and Telegram", async () => {
      const res = await app.request("/contact");
      const html = await res.text();
      expect(html).toContain("<svg");
      expect(html).toContain('viewBox="0 0 24 24"');
    });

    it("includes file name display element", async () => {
      const res = await app.request("/contact");
      const html = await res.text();
      expect(html).toContain('id="file-name-display"');
    });

    it("includes hx-encoding for multipart form data", async () => {
      const res = await app.request("/contact");
      const html = await res.text();
      expect(html).toContain('hx-encoding="multipart/form-data"');
    });

    it("is mobile-responsive with sm: breakpoints", async () => {
      const res = await app.request("/contact");
      const html = await res.text();
      expect(html).toContain("sm:flex-row");
    });
  });

  describe("POST /contact (JSON API)", () => {
    it("returns 200 on valid Discord submission", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "discord", message: "Hello team!" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.channel).toBe("discord");
      expect(mockedSendDiscord).toHaveBeenCalledWith({
        message: "Hello team!",
        contactInfo: undefined,
        fileName: undefined,
        fileContent: undefined,
      });
    });

    it("returns 200 on valid Telegram submission", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          message: "Feedback here",
          contactInfo: "@user",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.channel).toBe("telegram");
      expect(mockedSendTelegram).toHaveBeenCalledWith({
        message: "Feedback here",
        contactInfo: "@user",
      });
    });

    it("returns 400 on missing message", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "discord" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Message is required");
    });

    it("returns 400 on empty message", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "discord", message: "   " }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Message is required");
    });

    it("returns 400 on invalid channel", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "email", message: "test" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Channel must be");
    });

    it("returns 400 on missing channel", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "test" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Channel must be");
    });

    it("returns 400 on message > 4096 chars", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "discord",
          message: "x".repeat(4097),
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Message too long");
    });

    it("returns 400 on contactInfo > 200 chars", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "discord",
          message: "test",
          contactInfo: "x".repeat(201),
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Contact info too long");
    });

    it("returns 400 on invalid JSON", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });

    it("returns 429 on rate limit exceeded", async () => {
      const res1 = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "discord", message: "first" }),
      });
      expect(res1.status).toBe(200);

      const res2 = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "discord", message: "second" }),
      });
      expect(res2.status).toBe(429);
      const data = await res2.json();
      expect(data.error).toContain("Rate limit");
    });

    it("returns 500 on service error", async () => {
      mockedSendDiscord.mockRejectedValueOnce(new Error("DISCORD_WEBHOOK_URL not configured"));
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "discord", message: "test" }),
      });
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("DISCORD_WEBHOOK_URL not configured");
    });

    it("passes fileName and fileContent to Discord sender", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "discord",
          message: "see attached",
          fileName: "report.txt",
          fileContent: Buffer.from("hello").toString("base64"),
        }),
      });
      expect(res.status).toBe(200);
      expect(mockedSendDiscord).toHaveBeenCalledWith({
        message: "see attached",
        contactInfo: undefined,
        fileName: "report.txt",
        fileContent: expect.any(String),
      });
    });
  });

  describe("POST /contact (HTMX)", () => {
    const htmxHeaders = {
      "Content-Type": "application/json",
      "HX-Request": "true",
    };

    it("returns HTML success fragment on valid Discord submission", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: htmxHeaders,
        body: JSON.stringify({ channel: "discord", message: "Hello!" }),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("emerald");
      expect(html).toContain("discord");
      expect(html).toContain("Feedback sent");
    });

    it("returns HTML error fragment on validation error", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: htmxHeaders,
        body: JSON.stringify({ channel: "discord" }),
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("red");
      expect(html).toContain("Message is required");
    });

    it("returns HTML error fragment on rate limit", async () => {
      await app.request("/contact", {
        method: "POST",
        headers: htmxHeaders,
        body: JSON.stringify({ channel: "discord", message: "first" }),
      });

      const res2 = await app.request("/contact", {
        method: "POST",
        headers: htmxHeaders,
        body: JSON.stringify({ channel: "discord", message: "second" }),
      });
      expect(res2.status).toBe(429);
      const html = await res2.text();
      expect(html).toContain("red");
      expect(html).toContain("Rate limit");
    });

    it("returns HTML error fragment on service error", async () => {
      mockedSendDiscord.mockRejectedValueOnce(new Error("Webhook down"));
      const res = await app.request("/contact", {
        method: "POST",
        headers: htmxHeaders,
        body: JSON.stringify({ channel: "discord", message: "test" }),
      });
      expect(res.status).toBe(500);
      const html = await res.text();
      expect(html).toContain("red");
      expect(html).toContain("Webhook down");
    });
  });

  describe("POST /contact (multipart form-data)", () => {
    const formData = (channel: string, message: string, contactInfo?: string) => {
      const fd = new FormData();
      fd.append("channel", channel);
      fd.append("message", message);
      if (contactInfo) fd.append("contactInfo", contactInfo);
      return fd;
    };

    it("returns HTML success on valid Discord multipart submission", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: formData("discord", "Hello from form!"),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("emerald");
      expect(html).toContain("discord");
      expect(mockedSendDiscord).toHaveBeenCalledWith({
        message: "Hello from form!",
        contactInfo: undefined,
        fileName: undefined,
        fileContent: undefined,
      });
    });

    it("returns HTML success on valid Telegram multipart submission", async () => {
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: formData("telegram", "TG message", "@user"),
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("telegram");
      expect(mockedSendTelegram).toHaveBeenCalledWith({
        message: "TG message",
        contactInfo: "@user",
      });
    });

    it("returns HTML error on missing channel in multipart", async () => {
      const fd = new FormData();
      fd.append("message", "test");
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: fd,
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Channel must be");
    });

    it("returns HTML error on missing message in multipart", async () => {
      const fd = new FormData();
      fd.append("channel", "discord");
      const res = await app.request("/contact", {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: fd,
      });
      expect(res.status).toBe(400);
      const html = await res.text();
      expect(html).toContain("Message is required");
    });
  });

  describe("View exports", () => {
    it("contactPage returns HTML string with Layout", () => {
      const html = contactPage().toString();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<form");
      expect(html).toContain('hx-post="/contact"');
    });

    it("contactSuccessFragment returns styled success HTML", () => {
      const html = contactSuccessFragment("telegram");
      expect(html).toContain("emerald");
      expect(html).toContain("telegram");
      expect(html).toContain("Feedback sent");
    });

    it("contactErrorFragment returns styled error HTML", () => {
      const html = contactErrorFragment("Something went wrong");
      expect(html).toContain("red");
      expect(html).toContain("Something went wrong");
      expect(html).toContain("Failed to send");
    });
  });
});
