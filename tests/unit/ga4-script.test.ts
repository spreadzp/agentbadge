/**
 * SLICE-130-8: GA4 gtag.js script lib tests.
 *
 * Verifies that getGA4Script() returns the official gtag.js snippet
 * when enabled with a valid measurement ID, and "" otherwise.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getGA4Script } from "../../src/server/lib/ga4-script";

describe("SLICE-130-8: GA4 gtag.js script", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GA4_ENABLED;
    delete process.env.GA4_MEASUREMENT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns empty string when GA4_ENABLED not set", () => {
    expect(getGA4Script()).toBe("");
  });

  it("returns empty string when GA4_ENABLED=false", () => {
    process.env.GA4_ENABLED = "false";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123";
    expect(getGA4Script()).toBe("");
  });

  it("returns empty string when GA4_MEASUREMENT_ID not set", () => {
    process.env.GA4_ENABLED = "true";
    expect(getGA4Script()).toBe("");
  });

  it("returns both script tags with ID interpolated when enabled", () => {
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123";
    const script = getGA4Script();
    expect(script).toContain("https://www.googletagmanager.com/gtag/js?id=G-TEST123");
    expect(script).toContain("async");
    expect(script).toContain("window.dataLayer");
    expect(script).toContain("gtag('config','G-TEST123')");
    expect(script).toContain("<script");
  });

  it("returns empty string for invalid ID format (injection attempt)", () => {
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123';</script><script>alert(1)</script>";
    expect(getGA4Script()).toBe("");
  });

  it("returns empty string for ID without G- prefix", () => {
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "TEST123";
    expect(getGA4Script()).toBe("");
  });

  it("returns empty string for ID with lowercase (invalid format)", () => {
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "G-test123";
    expect(getGA4Script()).toBe("");
  });
});
