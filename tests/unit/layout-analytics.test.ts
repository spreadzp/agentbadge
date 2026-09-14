/**
 * SLICE-130-10: Layout injection tests for GA4 + Plausible.
 *
 * Verifies that all three layout shells inject analytics scripts
 * when env flags are enabled, and produce no extra output when disabled.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LandingLayout } from "../../src/views/landing/layout";
import { GuideLayout } from "../../src/views/guide-layout";
import { Layout } from "../../src/views/layout";

describe("SLICE-130-10: Layout analytics injection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
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

  describe("LandingLayout", () => {
    it("injects GA4 gtag.js when GA4_ENABLED + valid ID", () => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123";
      const html = LandingLayout("<div>test</div>", "Test").toString();
      expect(html).toContain("googletagmanager.com/gtag/js?id=G-TEST123");
      expect(html).toContain("gtag('config','G-TEST123')");
    });

    it("injects Plausible script when PLAUSIBLE_ENABLED + domain", () => {
      process.env.PLAUSIBLE_ENABLED = "true";
      process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
      const html = LandingLayout("<div>test</div>", "Test").toString();
      expect(html).toContain("plausible.io/js/script.js");
      expect(html).toContain('data-domain="agentbadge.xyz"');
    });

    it("injects both GA4 and Plausible when both enabled", () => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123";
      process.env.PLAUSIBLE_ENABLED = "true";
      process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
      const html = LandingLayout("<div>test</div>", "Test").toString();
      expect(html).toContain("googletagmanager.com");
      expect(html).toContain("plausible.io");
    });

    it("no analytics scripts when all flags off", () => {
      const html = LandingLayout("<div>test</div>", "Test").toString();
      expect(html).not.toContain("googletagmanager.com");
      expect(html).not.toContain("plausible.io/js/script.js");
    });
  });

  describe("GuideLayout", () => {
    it("injects GA4 gtag.js when GA4_ENABLED + valid ID", () => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123";
      const html = GuideLayout("Test Guide", "# Hello", [], "/guide").toString();
      expect(html).toContain("googletagmanager.com/gtag/js?id=G-TEST123");
    });

    it("injects Plausible script when PLAUSIBLE_ENABLED + domain", () => {
      process.env.PLAUSIBLE_ENABLED = "true";
      process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
      const html = GuideLayout("Test Guide", "# Hello", [], "/guide").toString();
      expect(html).toContain("plausible.io/js/script.js");
      expect(html).toContain('data-domain="agentbadge.xyz"');
    });

    it("no analytics scripts when all flags off", () => {
      const html = GuideLayout("Test Guide", "# Hello", [], "/guide").toString();
      expect(html).not.toContain("googletagmanager.com");
      expect(html).not.toContain("plausible.io/js/script.js");
    });
  });

  describe("Layout (dashboard)", () => {
    it("injects GA4 gtag.js when GA4_ENABLED + valid ID", () => {
      process.env.GA4_ENABLED = "true";
      process.env.GA4_MEASUREMENT_ID = "G-TEST123";
      const html = Layout("<div>test</div>", "Test").toString();
      expect(html).toContain("googletagmanager.com/gtag/js?id=G-TEST123");
    });

    it("already has Plausible (existing) when enabled", () => {
      process.env.PLAUSIBLE_ENABLED = "true";
      process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
      const html = Layout("<div>test</div>", "Test").toString();
      expect(html).toContain("plausible.io/js/script.js");
      expect(html).toContain('data-domain="agentbadge.xyz"');
    });

    it("no analytics scripts when all flags off", () => {
      const html = Layout("<div>test</div>", "Test").toString();
      expect(html).not.toContain("googletagmanager.com");
      expect(html).not.toContain("plausible.io/js/script.js");
    });
  });
});
