import { describe, it, expect } from "vitest";
import { renderBadgeSvg } from "../../../../src/agent-readiness/cli/commands/badge";

describe("renderBadgeSvg", () => {
  it("produces valid SVG with score", () => {
    const svg = renderBadgeSvg("agent readiness", 85);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("85/100");
  });

  it("uses green color for score >= 90", () => {
    const svg = renderBadgeSvg("agent readiness", 95);
    expect(svg).toContain("#4c1");
  });

  it("uses yellow color for score 70-89", () => {
    const svg = renderBadgeSvg("agent readiness", 75);
    expect(svg).toContain("#dfb317");
  });

  it("uses red color for score < 70", () => {
    const svg = renderBadgeSvg("agent readiness", 50);
    expect(svg).toContain("#e05d44");
  });

  it("includes label text in SVG", () => {
    const svg = renderBadgeSvg("agent readiness", 85);
    expect(svg).toContain("agent readiness");
  });

  it("can be used as --format badge output", () => {
    const svg = renderBadgeSvg("agent readiness", 72);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("72/100");
  });
});
