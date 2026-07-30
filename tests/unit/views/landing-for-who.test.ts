import { describe, it, expect } from "vitest";
import { ForWhoSection } from "../../../src/views/landing/for-who";

describe("SLICE-19-9: For Who section (3 audience cards)", () => {
  describe("ForWhoSection()", () => {
    it("returns HTML string", () => {
      const html = ForWhoSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id for-who", () => {
      const html = ForWhoSection().toString();
      expect(html).toContain('id="for-who"');
    });

    it("contains heading", () => {
      const html = ForWhoSection().toString();
      expect(html).toMatch(/<h2/i);
    });

    it("contains 3 audience cards", () => {
      const html = ForWhoSection().toString();
      expect(html).toMatch(/AI Agent Developer/i);
      expect(html).toMatch(/IDE|Coding Agent/i);
      expect(html).toMatch(/Autonomous Agent/i);
    });

    it("contains fade-in-up animation class", () => {
      const html = ForWhoSection().toString();
      expect(html).toContain("fade-in-up");
    });

    it("contains hover-lift class", () => {
      const html = ForWhoSection().toString();
      expect(html).toContain("hover-lift");
    });
  });
});
