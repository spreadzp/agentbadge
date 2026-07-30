import { describe, it, expect } from "vitest";
import { HeroSection } from "../../../src/views/landing/hero";

describe("SLICE-19-4: Hero section + CSS animations", () => {
  describe("HeroSection()", () => {
    it("returns HTML string", () => {
      const html = HeroSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains H1 with 'On-Chain Identity for AI Agents'", () => {
      const html = HeroSection().toString();
      expect(html).toContain("<h1");
      expect(html).toMatch(/On-Chain Identity for AI Agents/i);
    });

    it("contains UVP subheading", () => {
      const html = HeroSection().toString();
      // Subheading should mention Hedera or on-chain identity
      expect(html).toMatch(/Hedera|on-chain|AI agent/i);
    });

    it("contains 'Get Started' CTA linking to /agent-guide", () => {
      const html = HeroSection().toString();
      expect(html).toMatch(/Get Started/i);
      expect(html).toContain('href="/agent-guide"');
    });

    it("contains 'Explore Marketplace' CTA linking to /ui/market/tasks", () => {
      const html = HeroSection().toString();
      expect(html).toMatch(/Explore Marketplace/i);
      expect(html).toContain('href="/ui/market/tasks"');
    });

    it("contains animated gradient background class", () => {
      const html = HeroSection().toString();
      expect(html).toContain("gradient-animated");
    });

    it("contains fade-in-up animation class", () => {
      const html = HeroSection().toString();
      expect(html).toContain("fade-in-up");
    });

    it("contains pulse-glow animation class on CTA", () => {
      const html = HeroSection().toString();
      expect(html).toContain("pulse-glow");
    });

    it("contains section with id hero", () => {
      const html = HeroSection().toString();
      expect(html).toContain('id="hero"');
    });

    it("contains trust indicators or stats badges", () => {
      const html = HeroSection().toString();
      // Should mention Hedera, HTS, HCS, or similar trust signals
      expect(html).toMatch(/HTS|HCS|Hedera|NFT|DID/i);
    });
  });
});
