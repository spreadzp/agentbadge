import { describe, it, expect } from "vitest";
import { ProblemSolutionSection } from "../../../src/views/landing/problem-solution";

describe("SLICE-19-6: Problem→Solution section (4 cards)", () => {
  describe("ProblemSolutionSection()", () => {
    it("returns HTML string", () => {
      const html = ProblemSolutionSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id problem-solution", () => {
      const html = ProblemSolutionSection().toString();
      expect(html).toContain('id="problem-solution"');
    });

    it("contains heading", () => {
      const html = ProblemSolutionSection().toString();
      expect(html).toMatch(/<h2/i);
    });

    it("contains 4 problem→solution cards", () => {
      const html = ProblemSolutionSection().toString();
      // Card 1: No portable identity → NFT passports
      expect(html).toMatch(/portable identity|NFT passport/i);
      // Card 2: No discovery → HCS directory
      expect(html).toMatch(/discovery|HCS directory/i);
      // Card 3: No payments → HBAR x402
      expect(html).toMatch(/payment|HBAR|x402/i);
      // Card 4: No standard → MCP 38 tools
      expect(html).toMatch(/standard|MCP|38 tool/i);
    });

    it("each card has problem and solution text", () => {
      const html = ProblemSolutionSection().toString();
      // Should contain "problem" or "without" and "solution" or "with" patterns
      expect(html).toMatch(/without|problem/i);
      expect(html).toMatch(/with|solution|AgentBadge/i);
    });

    it("contains fade-in-up animation class", () => {
      const html = ProblemSolutionSection().toString();
      expect(html).toContain("fade-in-up");
    });

    it("contains hover-lift class for card interactivity", () => {
      const html = ProblemSolutionSection().toString();
      expect(html).toContain("hover-lift");
    });

    it("mentions Hedera or on-chain", () => {
      const html = ProblemSolutionSection().toString();
      expect(html).toMatch(/Hedera|on-chain/i);
    });
  });
});
