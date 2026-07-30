import { describe, it, expect } from "vitest";
import { CtaFooterSection } from "../../../src/views/landing/cta-footer";
import { LandingPage } from "../../../src/views/landing/landing-page";

describe("SLICE-19-11: CTA Footer section", () => {
  describe("CtaFooterSection()", () => {
    it("returns HTML string", () => {
      const html = CtaFooterSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id cta-footer", () => {
      const html = CtaFooterSection().toString();
      expect(html).toContain('id="cta-footer"');
    });

    it("contains heading Ready to onboard your agent?", () => {
      const html = CtaFooterSection().toString();
      expect(html).toMatch(/Ready to onboard your agent/i);
    });

    it("contains 3 CTA links", () => {
      const html = CtaFooterSection().toString();
      expect(html).toContain('href="/agent-guide"');
      expect(html).toContain('href="/pricing"');
      expect(html).toContain('href="/ui/agents"');
    });

    it("contains fade-in-up animation class", () => {
      const html = CtaFooterSection().toString();
      expect(html).toContain("fade-in-up");
    });
  });
});

describe("SLICE-19-11: LandingPage assembler", () => {
  describe("LandingPage()", () => {
    it("returns HTML string", () => {
      const html = LandingPage({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("wraps content in hx-boost div", () => {
      const html = LandingPage({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(html).toContain("hx-boost");
    });

    it("contains all 9 sections in order", () => {
      const html = LandingPage({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      // Check section ids appear in correct order
      const heroIdx = html.indexOf('id="hero"');
      const statsIdx = html.indexOf('id="landing-stats"');
      const psIdx = html.indexOf('id="problem-solution"');
      const featuresIdx = html.indexOf('id="features"');
      const howIdx = html.indexOf('id="how-it-works"');
      const whoIdx = html.indexOf('id="for-who"');
      const archIdx = html.indexOf('id="architecture"');
      const pricingIdx = html.indexOf('id="pricing"');
      const ctaIdx = html.indexOf('id="cta-footer"');

      // All sections present
      expect(heroIdx).toBeGreaterThan(-1);
      expect(statsIdx).toBeGreaterThan(-1);
      expect(psIdx).toBeGreaterThan(-1);
      expect(featuresIdx).toBeGreaterThan(-1);
      expect(howIdx).toBeGreaterThan(-1);
      expect(whoIdx).toBeGreaterThan(-1);
      expect(archIdx).toBeGreaterThan(-1);
      expect(pricingIdx).toBeGreaterThan(-1);
      expect(ctaIdx).toBeGreaterThan(-1);

      // Correct order
      expect(heroIdx).toBeLessThan(statsIdx);
      expect(statsIdx).toBeLessThan(psIdx);
      expect(psIdx).toBeLessThan(featuresIdx);
      expect(featuresIdx).toBeLessThan(howIdx);
      expect(howIdx).toBeLessThan(whoIdx);
      expect(whoIdx).toBeLessThan(archIdx);
      expect(archIdx).toBeLessThan(pricingIdx);
      expect(pricingIdx).toBeLessThan(ctaIdx);
    });
  });
});
