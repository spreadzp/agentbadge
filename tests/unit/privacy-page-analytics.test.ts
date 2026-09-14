/**
 * SLICE-130-13: Privacy page analytics disclosure tests.
 *
 * Verifies that /privacy page discloses optional analytics
 * (GA4 / Plausible) instead of claiming zero analytics.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrivacyPage } from "../../src/views/privacy-page";

describe("SLICE-130-13: Privacy page analytics disclosure", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.KEEPERHUB_ENABLED;
    delete process.env.ATTESTCOIN_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does NOT contain absolute 'No third-party analytics' claim", () => {
    const html = PrivacyPage().toString();
    expect(html).not.toContain("No third-party analytics");
  });

  it("mentions Plausible as cookieless option", () => {
    const html = PrivacyPage().toString();
    expect(html).toContain("Plausible");
    expect(html.toLowerCase()).toContain("cookieless");
  });

  it("mentions Google Analytics 4 with cookies", () => {
    const html = PrivacyPage().toString();
    expect(html).toContain("Google Analytics");
  });

  it("states analytics are disabled by default", () => {
    const html = PrivacyPage().toString();
    expect(html.toLowerCase()).toContain("disabled by default");
  });

  it("does not claim zero cookies unconditionally", () => {
    const html = PrivacyPage().toString();
    // The old "none. We do not use tracking, analytics, advertising, or session cookies" must be gone
    expect(html).not.toContain("We do not use tracking, analytics, advertising, or session cookies");
  });
});
