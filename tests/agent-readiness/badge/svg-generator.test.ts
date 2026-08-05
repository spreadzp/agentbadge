import { describe, it, expect } from "vitest";
import {
  generateBadgeSvg,
  scoreToColor,
  isStale,
  escapeXml,
  formatDate,
  type BadgeInput,
} from "../../../src/agent-readiness/badge/svg-generator";

const baseInput: BadgeInput = {
  scope: "test-api@api.example.com",
  score: 85,
  rulesetVersion: "1.2.0",
  scannedAt: "2025-01-15T10:00:00.000Z",
  reportUrl: "https://agentbadge.dev/r/test-api",
  stale: false,
};

describe("SLICE-38-1 + 38-2: SVG Badge Generator", () => {
  describe("scoreToColor", () => {
    it("score 91 → green (#4c1)", () => {
      expect(scoreToColor(91)).toBe("#4c1");
    });

    it("score 90 → green (#4c1) — boundary", () => {
      expect(scoreToColor(90)).toBe("#4c1");
    });

    it("score 100 → green (#4c1)", () => {
      expect(scoreToColor(100)).toBe("#4c1");
    });

    it("score 75 → yellow (#dfb317)", () => {
      expect(scoreToColor(75)).toBe("#dfb317");
    });

    it("score 70 → yellow (#dfb317) — boundary", () => {
      expect(scoreToColor(70)).toBe("#dfb317");
    });

    it("score 89 → yellow (#dfb317) — boundary", () => {
      expect(scoreToColor(89)).toBe("#dfb317");
    });

    it("score 50 → red (#e05d44)", () => {
      expect(scoreToColor(50)).toBe("#e05d44");
    });

    it("score 69 → red (#e05d44) — boundary", () => {
      expect(scoreToColor(69)).toBe("#e05d44");
    });

    it("score 0 → red (#e05d44)", () => {
      expect(scoreToColor(0)).toBe("#e05d44");
    });
  });

  describe("generateBadgeSvg — basic", () => {
    it("produces SVG with green color for score 91", () => {
      const svg = generateBadgeSvg({ ...baseInput, score: 91 });
      expect(svg).toContain("#4c1");
    });

    it("produces SVG with yellow color for score 75", () => {
      const svg = generateBadgeSvg({ ...baseInput, score: 75 });
      expect(svg).toContain("#dfb317");
    });

    it("produces SVG with red color for score 50", () => {
      const svg = generateBadgeSvg({ ...baseInput, score: 50 });
      expect(svg).toContain("#e05d44");
    });

    it("is deterministic — same input produces identical output", () => {
      const input: BadgeInput = {
        ...baseInput,
        score: 85,
        stale: false,
      };
      const svg1 = generateBadgeSvg(input);
      const svg2 = generateBadgeSvg(input);
      expect(svg1).toBe(svg2);
    });

    it("is deterministic for stale=true — same input produces identical output", () => {
      const input: BadgeInput = {
        ...baseInput,
        score: 85,
        stale: true,
      };
      const svg1 = generateBadgeSvg(input);
      const svg2 = generateBadgeSvg(input);
      expect(svg1).toBe(svg2);
    });

    it("uses monospace font family", () => {
      const svg = generateBadgeSvg(baseInput);
      expect(svg).toContain('font-family="monospace"');
    });

    it("contains <a href> link to report URL", () => {
      const svg = generateBadgeSvg(baseInput);
      expect(svg).toContain('<a href="https://agentbadge.dev/r/test-api">');
    });

    it("contains <title> with scope name", () => {
      const svg = generateBadgeSvg({ ...baseInput, scope: "my-scope" });
      expect(svg).toContain("<title>Agent Readiness Badge — my-scope</title>");
    });

    it("contains score label in SVG text (fresh)", () => {
      const svg = generateBadgeSvg({ ...baseInput, score: 85, stale: false });
      expect(svg).toContain("85/100");
      expect(svg).not.toContain("⚠ stale");
    });

    it("produces valid SVG root element", () => {
      const svg = generateBadgeSvg(baseInput);
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it("does not contain Date.now() or new Date() in output", () => {
      const svg = generateBadgeSvg(baseInput);
      expect(svg).not.toContain("Date.now");
      expect(svg).not.toContain("new Date");
    });
  });

  describe("generateBadgeSvg — stale state (SLICE-38-2)", () => {
    it("stale=true → SVG contains ⚠ stale", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: true });
      expect(svg).toContain("⚠ stale");
    });

    it("stale=false → SVG does NOT contain ⚠ stale", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: false });
      expect(svg).not.toContain("⚠ stale");
    });

    it("stale=true → <title> contains [stale]", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: true, scope: "my-scope" });
      expect(svg).toContain("[stale]");
      expect(svg).toContain("Agent Readiness Badge — my-scope [stale]");
    });

    it("stale=false → <title> does NOT contain [stale]", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: false });
      expect(svg).not.toContain("[stale]");
    });

    it("stale=true → aria-label contains (stale)", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: true, score: 85 });
      expect(svg).toContain("(stale)");
    });

    it("stale=false → aria-label does NOT contain (stale)", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: false });
      expect(svg).not.toContain("(stale)");
    });

    it("stale=true → badge width is 210", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: true });
      expect(svg).toContain('width="210"');
    });

    it("stale=false → badge width is 180", () => {
      const svg = generateBadgeSvg({ ...baseInput, stale: false });
      expect(svg).toContain('width="180"');
    });

    it("stale badge width > normal badge width", () => {
      const freshSvg = generateBadgeSvg({ ...baseInput, stale: false });
      const staleSvg = generateBadgeSvg({ ...baseInput, stale: true });
      const freshWidth = parseInt(freshSvg.match(/width="(\d+)"/)![1], 10);
      const staleWidth = parseInt(staleSvg.match(/width="(\d+)"/)![1], 10);
      expect(staleWidth).toBeGreaterThan(freshWidth);
    });

    it("stale=true with score 90 → green + stale label", () => {
      const svg = generateBadgeSvg({ ...baseInput, score: 90, stale: true });
      expect(svg).toContain("#4c1");
      expect(svg).toContain("⚠ stale");
    });

    it("stale=true with score 70 → yellow + stale label", () => {
      const svg = generateBadgeSvg({ ...baseInput, score: 70, stale: true });
      expect(svg).toContain("#dfb317");
      expect(svg).toContain("⚠ stale");
    });

    it("stale=true with score 69 → red + stale label", () => {
      const svg = generateBadgeSvg({ ...baseInput, score: 69, stale: true });
      expect(svg).toContain("#e05d44");
      expect(svg).toContain("⚠ stale");
    });
  });

  describe("generateBadgeSvg — metadata section (SLICE-38-3)", () => {
    it("SVG height is 56 (room for metadata)", () => {
      const svg = generateBadgeSvg(baseInput);
      expect(svg).toContain('height="56"');
    });

    it("contains scope in metadata", () => {
      const svg = generateBadgeSvg({ ...baseInput, scope: "my-api@v2" });
      expect(svg).toContain("my-api@v2");
    });

    it("contains ruleset version in metadata", () => {
      const svg = generateBadgeSvg({ ...baseInput, rulesetVersion: "2.0.0" });
      expect(svg).toContain("ruleset v2.0.0");
    });

    it("contains formatted date from scannedAt", () => {
      const svg = generateBadgeSvg({ ...baseInput, scannedAt: "2025-03-20T14:30:00.000Z" });
      expect(svg).toContain("2025-03-20");
    });

    it("uses 9px font for metadata", () => {
      const svg = generateBadgeSvg(baseInput);
      expect(svg).toContain('font-size="9"');
    });

    it("metadata text uses monospace font", () => {
      const svg = generateBadgeSvg(baseInput);
      const metaSection = svg.split("</a>")[1];
      expect(metaSection).toContain('font-family="monospace"');
    });

    it("is deterministic with metadata — same input = same output", () => {
      const input: BadgeInput = {
        ...baseInput,
        scannedAt: "2025-01-15T10:00:00.000Z",
        score: 85,
        stale: false,
      };
      expect(generateBadgeSvg(input)).toBe(generateBadgeSvg(input));
    });
  });

  describe("formatDate", () => {
    it("formats ISO string to YYYY-MM-DD", () => {
      expect(formatDate("2025-01-15T10:00:00.000Z")).toBe("2025-01-15");
    });

    it("formats date with UTC", () => {
      expect(formatDate("2025-03-20T23:59:00.000Z")).toBe("2025-03-20");
    });

    it("formats end of year", () => {
      expect(formatDate("2025-12-31T23:59:59.999Z")).toBe("2025-12-31");
    });

    it("formats start of year", () => {
      expect(formatDate("2025-01-01T00:00:00.000Z")).toBe("2025-01-01");
    });
  });

  describe("escapeXml", () => {
    it("escapes & characters", () => {
      expect(escapeXml("a&b")).toBe("a&amp;b");
    });

    it("escapes < characters", () => {
      expect(escapeXml("a<b")).toBe("a&lt;b");
    });

    it("escapes > characters", () => {
      expect(escapeXml("a>b")).toBe("a&gt;b");
    });

    it("escapes \" characters", () => {
      expect(escapeXml('a"b')).toBe("a&quot;b");
    });

    it("escapes ' characters", () => {
      expect(escapeXml("a'b")).toBe("a&apos;b");
    });

    it("escapes all special characters together", () => {
      expect(escapeXml('<a href="x">&\'test\'</a>')).toBe(
        "&lt;a href=&quot;x&quot;&gt;&amp;&apos;test&apos;&lt;/a&gt;",
      );
    });

    it("handles empty string", () => {
      expect(escapeXml("")).toBe("");
    });

    it("handles string with no special characters", () => {
      expect(escapeXml("hello world")).toBe("hello world");
    });
  });

  describe("isStale", () => {
    it("returns false for report scanned today", () => {
      const today = new Date().toISOString();
      expect(isStale(today, 7)).toBe(false);
    });

    it("returns true for report scanned 8 days ago with TTL 7", () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      expect(isStale(eightDaysAgo, 7)).toBe(true);
    });

    it("returns false for report scanned 6 days ago with TTL 7", () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      expect(isStale(sixDaysAgo, 7)).toBe(false);
    });

    it("returns true for report scanned 30 days ago with TTL 7", () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(isStale(thirtyDaysAgo, 7)).toBe(true);
    });
  });
});
