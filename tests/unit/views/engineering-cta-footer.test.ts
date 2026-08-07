import { describe, it, expect } from "vitest";
import { EngineeringCtaSection } from "../../../src/views/landing/engineering-cta";
import { Footer } from "../../../src/views/footer";

describe("SLICE-46-8: Engineering CTA + Footer links", () => {
  describe("EngineeringCtaSection()", () => {
    it("returns HTML string", () => {
      const html = EngineeringCtaSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id engineering-cta", () => {
      const html = EngineeringCtaSection().toString();
      expect(html).toContain('id="engineering-cta"');
    });

    it("contains heading 'Need more than a score?'", () => {
      const html = EngineeringCtaSection().toString();
      expect(html).toMatch(/Need more than a score/i);
    });

    it("contains link to /team", () => {
      const html = EngineeringCtaSection().toString();
      expect(html).toContain('href="/team"');
    });

    it("contains link to /services", () => {
      const html = EngineeringCtaSection().toString();
      expect(html).toContain('href="/services"');
    });

    it("mentions MCP servers, smart contracts, AI agent systems", () => {
      const html = EngineeringCtaSection().toString();
      expect(html).toMatch(/MCP servers/i);
      expect(html).toMatch(/smart contracts/i);
      expect(html).toMatch(/AI agent/i);
    });
  });

  describe("Footer() — Engineering links", () => {
    it("contains link to /team", () => {
      const html = Footer().toString();
      expect(html).toContain('href="/team"');
    });

    it("contains link to /services", () => {
      const html = Footer().toString();
      expect(html).toContain('href="/services"');
    });

    it("contains link to /work-with-us", () => {
      const html = Footer().toString();
      expect(html).toContain('href="/work-with-us"');
    });
  });
});
