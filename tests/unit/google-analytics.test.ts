/**
 * SLICE-130-6: GA4 Measurement Protocol library tests.
 *
 * Verifies that:
 * - Disabled env → no fetch call, no throw
 * - Enabled env → correct POST body with measurement_id + api_secret in URL
 * - Fetch failure → warning logged, no exception propagated
 * - API secret never logged
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isGa4Enabled,
  trackPageView,
  trackEvent,
} from "../../src/server/lib/google-analytics";

describe("SLICE-130-6: GA4 Measurement Protocol", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GA4_ENABLED;
    delete process.env.GA4_MEASUREMENT_ID;
    delete process.env.GA4_API_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("isGa4Enabled", () => {
    it("returns false when GA4_ENABLED is not set", () => {
      expect(isGa4Enabled()).toBe(false);
    });

    it("returns false when GA4_ENABLED=true but measurement_id missing", () => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_API_SECRET = "secret123";
      expect(isGa4Enabled()).toBe(false);
    });

    it("returns false when GA4_ENABLED=true but api_secret missing", () => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123";
      expect(isGa4Enabled()).toBe(false);
    });

    it("returns true when all three vars are set", () => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123";
      process.env.GA4_API_SECRET = "secret123";
      expect(isGa4Enabled()).toBe(true);
    });
  });

  describe("trackPageView — disabled", () => {
    it("does not call fetch when disabled", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      await trackPageView("/blog", "Blog");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not throw when disabled", async () => {
      globalThis.fetch = vi.fn(() => {
        throw new Error("should not be called");
      }) as unknown as typeof fetch;
      await expect(trackPageView("/blog", "Blog")).resolves.toBeUndefined();
    });
  });

  describe("trackPageView — enabled", () => {
    beforeEach(() => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123456";
      process.env.GA4_API_SECRET = "test_secret_abc";
    });

    it("calls fetch with measurement_id and api_secret in URL", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response("{}", { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await trackPageView("/blog", "Blog");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("measurement_id=G-TEST123456");
      expect(url).toContain("api_secret=test_secret_abc");
      expect(url).toContain("https://www.google-analytics.com/mp/collect");
    });

    it("sends page_view event with correct params in body", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response("{}", { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await trackPageView("/blog", "Blog", "https://google.com");

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.client_id).toBeDefined();
      expect(body.events).toHaveLength(1);
      expect(body.events[0].name).toBe("page_view");
      expect(body.events[0].params.page_title).toBe("Blog");
      expect(body.events[0].params.page_location).toContain("/blog");
      expect(body.events[0].params.page_referrer).toBe("https://google.com");
    });

    it("omits page_referrer when not provided", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response("{}", { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await trackPageView("/", "Home");

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events[0].params.page_referrer).toBeUndefined();
    });
  });

  describe("trackEvent — enabled", () => {
    beforeEach(() => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123456";
      process.env.GA4_API_SECRET = "test_secret_abc";
    });

    it("sends custom event with params", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response("{}", { status: 200 }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await trackEvent("scan_started", { domain: "example.com", rules: 14 });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events[0].name).toBe("scan_started");
      expect(body.events[0].params.domain).toBe("example.com");
      expect(body.events[0].params.rules).toBe(14);
    });
  });

  describe("trackEvent — disabled", () => {
    it("does not call fetch when disabled", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      await trackEvent("scan_started", { domain: "example.com" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123456";
      process.env.GA4_API_SECRET = "test_secret_abc";
    });

    it("swallows fetch errors without throwing", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
      globalThis.fetch = vi.fn(() => {
        throw new Error("network timeout");
      }) as unknown as typeof fetch;

      await expect(trackPageView("/blog", "Blog")).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("logs warning on non-ok response without throwing", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("error", { status: 500 }),
      ) as unknown as typeof fetch;

      await expect(trackPageView("/blog", "Blog")).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("never logs the API secret", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
      globalThis.fetch = vi.fn(() => {
        throw new Error("network timeout");
      }) as unknown as typeof fetch;

      await trackPageView("/blog", "Blog");
      const warnCalls = warnSpy.mock.calls.map((c) => String(c));
      for (const msg of warnCalls) {
        expect(msg).not.toContain("test_secret_abc");
      }
    });
  });
});
