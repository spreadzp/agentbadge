import { describe, it, expect } from "vitest";
import { generateRobotsTxt } from "../../src/agent-readiness/generators/robots-generator";

describe("SLICE-48-24: Robots.txt generator", () => {
  it("generates robots.txt with 21 AI bots", () => {
    const robots = generateRobotsTxt({ allowAll: true });
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).toContain("User-agent: ClaudeBot");
    expect(robots).toContain("User-agent: PerplexityBot");
    expect(robots).toContain("User-agent: Bytespider");
    const count = (robots.match(/User-agent:/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(21);
  });

  it("supports disallow specific bots", () => {
    const robots = generateRobotsTxt({ disallow: ["Bytespider"] });
    expect(robots).toContain("User-agent: Bytespider\nDisallow: /");
  });

  it("includes Allow: / for allowed bots", () => {
    const robots = generateRobotsTxt({ allowAll: true });
    expect(robots).toContain("User-agent: GPTBot\nAllow: /");
  });

  it("supports sitemap", () => {
    const robots = generateRobotsTxt({ allowAll: true, sitemap: "https://example.com/sitemap.xml" });
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
  });
});
