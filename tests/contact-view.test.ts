import { describe, it, expect } from "vitest";
import {
  contactPage,
  contactSuccessFragment,
  contactErrorFragment,
} from "../src/views/contact-page";

describe("Contact View", () => {
  describe("contactPage()", () => {
    const html = contactPage().toString();

    it("returns a full HTML document with Layout", () => {
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    it("contains a form with hx-post", () => {
      expect(html).toContain("<form");
      expect(html).toContain('hx-post="/contact"');
    });

    it("has correct HTMX target and swap", () => {
      expect(html).toContain('hx-target="#contact-result"');
      expect(html).toContain('hx-swap="innerHTML"');
    });

    it("has hx-encoding for file uploads", () => {
      expect(html).toContain('hx-encoding="multipart/form-data"');
    });

    it("contains Discord channel button", () => {
      expect(html).toContain('data-channel="discord"');
      expect(html).toContain("Discord");
    });

    it("contains Telegram channel button", () => {
      expect(html).toContain('data-channel="telegram"');
      expect(html).toContain("Telegram");
    });

    it("has hidden channel input", () => {
      expect(html).toContain('name="channel"');
      expect(html).toContain('id="channel-input"');
      expect(html).toContain('type="hidden"');
    });

    it("has message textarea with maxlength 4096", () => {
      expect(html).toContain('name="message"');
      expect(html).toContain('maxlength="4096"');
      expect(html).toContain("<textarea");
    });

    it("has character counter element", () => {
      expect(html).toContain('id="char-count"');
      expect(html).toContain("/ 4096");
    });

    it("has optional contact info input with maxlength 200", () => {
      expect(html).toContain('name="contactInfo"');
      expect(html).toContain('maxlength="200"');
    });

    it("has file upload input", () => {
      expect(html).toContain('type="file"');
      expect(html).toContain('name="file"');
      expect(html).toContain('id="file-input"');
    });

    it("has file name display element", () => {
      expect(html).toContain('id="file-name-display"');
    });

    it("has submit button with disabled state", () => {
      expect(html).toContain('type="submit"');
      expect(html).toContain('id="submit-btn"');
      expect(html).toContain("disabled");
      expect(html).toContain("Send Feedback");
    });

    it("has result container for HTMX response", () => {
      expect(html).toContain('id="contact-result"');
    });

    it("includes SVG icons", () => {
      expect(html).toContain("<svg");
      expect(html).toContain('viewBox="0 0 24 24"');
    });

    it("has client-side JS for channel selection", () => {
      expect(html).toContain("channel-btn");
      expect(html).toContain("addEventListener");
      expect(html).toContain("updateSubmitBtn");
    });

    it("has client-side JS for character counter", () => {
      expect(html).toContain("char-count");
      expect(html).toContain("textarea");
    });

    it("has client-side JS for file name display", () => {
      expect(html).toContain("file-input");
      expect(html).toContain("file-name-display");
      expect(html).toContain("fileInput.files");
    });

    it("is mobile-responsive with sm: breakpoints", () => {
      expect(html).toContain("sm:flex-row");
    });

    it("uses slate/emerald theme", () => {
      expect(html).toContain("slate-");
      expect(html).toContain("emerald-");
    });
  });

  describe("contactSuccessFragment()", () => {
    it("returns styled success message for discord", () => {
      const html = contactSuccessFragment("discord");
      expect(html).toContain("emerald");
      expect(html).toContain("discord");
      expect(html).toContain("Feedback sent");
    });

    it("returns styled success message for telegram", () => {
      const html = contactSuccessFragment("telegram");
      expect(html).toContain("emerald");
      expect(html).toContain("telegram");
      expect(html).toContain("Feedback sent");
    });

    it("contains thank you message", () => {
      const html = contactSuccessFragment("discord");
      expect(html).toContain("Thank you");
    });
  });

  describe("contactErrorFragment()", () => {
    it("returns styled error message", () => {
      const html = contactErrorFragment("Something went wrong");
      expect(html).toContain("red");
      expect(html).toContain("Something went wrong");
      expect(html).toContain("Failed to send");
    });

    it("displays the error text", () => {
      const html = contactErrorFragment("DISCORD_WEBHOOK_URL not configured");
      expect(html).toContain("DISCORD_WEBHOOK_URL not configured");
    });
  });
});
