import { describe, it, expect } from "vitest";
import { HowItWorksSection } from "../../../src/views/landing/how-it-works";
import { howToLd } from "../../../src/server/lib/json-ld";

describe("SLICE-19-7: How It Works section (4 steps)", () => {
  describe("HowItWorksSection()", () => {
    it("returns HTML string", () => {
      const html = HowItWorksSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id how-it-works", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain('id="how-it-works"');
    });

    it("contains heading", () => {
      const html = HowItWorksSection().toString();
      expect(html).toMatch(/<h2/i);
    });

    it("contains 4 steps", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain("Request a Passport");
      expect(html).toContain("Receive NFT Passport");
      expect(html).toContain("Register in HCS Directory");
      expect(html).toContain("Start Interacting with Other Agents");
    });

    it("step titles match HowTo JSON-LD exactly", () => {
      const html = HowItWorksSection().toString();
      const schema = howToLd() as Record<string, unknown>;
      const steps = schema.step as Record<string, unknown>[];
      for (const step of steps) {
        const name = step.name as string;
        expect(html).toContain(name);
      }
    });

    it("contains step numbers 1-4", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain("1");
      expect(html).toContain("2");
      expect(html).toContain("3");
      expect(html).toContain("4");
    });

    it("contains fade-in-up animation class", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain("fade-in-up");
    });

    it("mentions Hedera", () => {
      const html = HowItWorksSection().toString();
      expect(html).toMatch(/Hedera/i);
    });
  });
});
