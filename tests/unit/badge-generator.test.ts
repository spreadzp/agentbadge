import { describe, it, expect } from "vitest";
import { generateBadgeSvg } from "../../src/agent-readiness/generators/badge-generator";

describe("SLICE-48-25: Badge SVG generator", () => {
  it("generates SVG with score 85", () => {
    const svg = generateBadgeSvg({
      score: 85,
      grade: "A",
      categories: [
        { name: "discovery", score: 90 },
        { name: "payments", score: 80 },
      ],
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("85");
    expect(svg).toContain("A");
  });

  it("uses green color for score >= 80", () => {
    const svg = generateBadgeSvg({ score: 85, grade: "A", categories: [] });
    expect(svg).toContain("#22c55e");
  });

  it("uses red color for score < 50", () => {
    const svg = generateBadgeSvg({ score: 30, grade: "F", categories: [] });
    expect(svg).toContain("#ef4444");
  });

  it("uses yellow color for score 50-79", () => {
    const svg = generateBadgeSvg({ score: 65, grade: "C", categories: [] });
    expect(svg).toContain("#eab308");
  });

  it("includes category bars", () => {
    const svg = generateBadgeSvg({
      score: 70,
      grade: "C",
      categories: [{ name: "discovery", score: 80 }],
    });
    expect(svg).toContain("discovery");
    expect(svg).toContain("80");
  });
});
