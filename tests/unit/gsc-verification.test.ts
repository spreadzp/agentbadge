/**
 * SLICE-130-14: GSC verification meta tag tests.
 *
 * Tests the gsc-verification lib and verifies meta tag injection
 * in all 3 layouts when GOOGLE_SITE_VERIFICATION is set.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Layout } from "../../src/views/layout";
import { LandingLayout } from "../../src/views/landing/layout";
import { GuideLayout } from "../../src/views/guide-layout";

// ─── Lib unit tests ──────────────────────────────────────────────

import { getGscVerificationMeta } from "../../src/server/lib/gsc-verification";

describe("SLICE-130-14: gsc-verification lib", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_SITE_VERIFICATION;
    delete process.env.KEEPERHUB_ENABLED;
    delete process.env.ATTESTCOIN_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("env unset → empty string", () => {
    expect(getGscVerificationMeta()).toBe("");
  });

  it("env set valid → meta tag with content", () => {
    process.env.GOOGLE_SITE_VERIFICATION = "abc123XYZ_test-code";
    const meta = getGscVerificationMeta();
    expect(meta).toContain('name="google-site-verification"');
    expect(meta).toContain('content="abc123XYZ_test-code"');
  });

  it("invalid content with spaces → empty string", () => {
    process.env.GOOGLE_SITE_VERIFICATION = "invalid content with spaces";
    expect(getGscVerificationMeta()).toBe("");
  });

  it("invalid content with quotes → empty string", () => {
    process.env.GOOGLE_SITE_VERIFICATION = 'abc"; alert(1); "';
    expect(getGscVerificationMeta()).toBe("");
  });

  it("invalid content with HTML tags → empty string", () => {
    process.env.GOOGLE_SITE_VERIFICATION = "<script>alert(1)</script>";
    expect(getGscVerificationMeta()).toBe("");
  });
});

// ─── Layout injection tests ──────────────────────────────────────

describe("SLICE-130-14: GSC meta in layouts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_SITE_VERIFICATION;
    delete process.env.GA4_ENABLED;
    delete process.env.GA4_MEASUREMENT_ID;
    delete process.env.PLAUSIBLE_ENABLED;
    delete process.env.PLAUSIBLE_DOMAIN;
    delete process.env.KEEPERHUB_ENABLED;
    delete process.env.ATTESTCOIN_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("env unset → no GSC meta in any layout", () => {
    const html1 = Layout("", "Test", { title: "Test", description: "Test", path: "/" }).toString();
    const html2 = LandingLayout("", "Test", { title: "Test", description: "Test", path: "/" }).toString();
    const html3 = GuideLayout("Test", "# Test", [], "/test").toString();

    expect(html1).not.toContain("google-site-verification");
    expect(html2).not.toContain("google-site-verification");
    expect(html3).not.toContain("google-site-verification");
  });

  it("env set → GSC meta in all 3 layouts", () => {
    process.env.GOOGLE_SITE_VERIFICATION = "validCode123_test";

    const html1 = Layout("", "Test", { title: "Test", description: "Test", path: "/" }).toString();
    const html2 = LandingLayout("", "Test", { title: "Test", description: "Test", path: "/" }).toString();
    const html3 = GuideLayout("Test", "# Test", [], "/test").toString();

    expect(html1).toContain("google-site-verification");
    expect(html1).toContain("validCode123_test");
    expect(html2).toContain("google-site-verification");
    expect(html2).toContain("validCode123_test");
    expect(html3).toContain("google-site-verification");
    expect(html3).toContain("validCode123_test");
  });
});
