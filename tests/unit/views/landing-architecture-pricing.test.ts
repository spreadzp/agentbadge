import { describe, it, expect } from "vitest";
import { ArchitectureSection } from "../../../src/views/landing/architecture";
import { PricingPreviewSection } from "../../../src/views/landing/pricing-preview";

describe("SLICE-19-10: Architecture section", () => {
  describe("ArchitectureSection()", () => {
    it("returns HTML string", () => {
      const html = ArchitectureSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id architecture", () => {
      const html = ArchitectureSection().toString();
      expect(html).toContain('id="architecture"');
    });

    it("contains heading", () => {
      const html = ArchitectureSection().toString();
      expect(html).toMatch(/<h2/i);
    });

    it("contains 6 tech pills", () => {
      const html = ArchitectureSection().toString();
      expect(html).toMatch(/HTS/i);
      expect(html).toMatch(/HCS/i);
      expect(html).toMatch(/Mirror Node/i);
      expect(html).toMatch(/x402/i);
      expect(html).toMatch(/MCP/i);
      expect(html).toMatch(/IPFS/i);
    });

    it("contains link to /about", () => {
      const html = ArchitectureSection().toString();
      expect(html).toContain('href="/about"');
    });

    it("contains fade-in-up animation class", () => {
      const html = ArchitectureSection().toString();
      expect(html).toContain("fade-in-up");
    });
  });
});

describe("SLICE-19-10: Pricing Preview section", () => {
  describe("PricingPreviewSection()", () => {
    it("returns HTML string", () => {
      const html = PricingPreviewSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id pricing", () => {
      const html = PricingPreviewSection().toString();
      expect(html).toContain('id="pricing"');
    });

    it("contains heading", () => {
      const html = PricingPreviewSection().toString();
      expect(html).toMatch(/<h2/i);
    });

    it("contains 4 tier cards", () => {
      const html = PricingPreviewSection().toString();
      expect(html).toMatch(/Bronze/i);
      expect(html).toMatch(/Silver/i);
      expect(html).toMatch(/Gold/i);
      expect(html).toMatch(/Platinum/i);
    });

    it("contains HBAR prices", () => {
      const html = PricingPreviewSection().toString();
      expect(html).toContain("10");
      expect(html).toContain("50");
      expect(html).toContain("200");
      expect(html).toContain("500");
      expect(html).toMatch(/HBAR/i);
    });

    it("highlights Gold tier with Popular badge and ring", () => {
      const html = PricingPreviewSection().toString();
      // Gold card should have ring-2 class and a "Popular" badge
      expect(html).toContain("ring-2");
      expect(html).toContain("Popular");
    });

    it("contains link to /pricing", () => {
      const html = PricingPreviewSection().toString();
      expect(html).toContain('href="/pricing"');
    });

    it("contains fade-in-up animation class", () => {
      const html = PricingPreviewSection().toString();
      expect(html).toContain("fade-in-up");
    });
  });
});
