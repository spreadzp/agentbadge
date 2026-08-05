import { describe, it, expect } from "vitest";
import { FeaturesSection } from "../../../src/views/landing/features";

describe("SLICE-19-8: Features section (6 capability cards)", () => {
  describe("FeaturesSection()", () => {
    it("returns HTML string", () => {
      const html = FeaturesSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id features", () => {
      const html = FeaturesSection().toString();
      expect(html).toContain('id="features"');
    });

    it("contains heading", () => {
      const html = FeaturesSection().toString();
      expect(html).toMatch(/<h2/i);
    });

    it("contains 6 feature cards", () => {
      const html = FeaturesSection().toString();
      // Card 1: HTS NFT Passports
      expect(html).toMatch(/HTS NFT Passport/i);
      // Card 2: HCS Agent Directory
      expect(html).toMatch(/HCS.*Directory|Agent Directory/i);
      // Card 3: A2A Messaging
      expect(html).toMatch(/A2A|Messaging/i);
      // Card 4: Task Marketplace
      expect(html).toMatch(/Task Marketplace|Marketplace/i);
      // Card 5: MCP Server
      expect(html).toMatch(/MCP Server|38 tool/i);
      // Card 6: x402 Micropayments
      expect(html).toMatch(/x402|Micropayment/i);
    });

    it("contains fade-in-up animation class", () => {
      const html = FeaturesSection().toString();
      expect(html).toContain("fade-in-up");
    });

    it("contains hover-lift class for card interactivity", () => {
      const html = FeaturesSection().toString();
      expect(html).toContain("hover-lift");
    });

    it("mentions Hedera", () => {
      const html = FeaturesSection().toString();
      expect(html).toMatch(/Hedera/i);
    });
  });
});
