import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("SLICE-23-7: Lighthouse CI regression test config", () => {
  const configPath = resolve(process.cwd(), "lighthouserc.cjs");
  let config: { ci: { collect: { url: string[] }; assert: { assertions: Record<string, [string, { minScore: number }]> } } };

  it("lighthouserc.js exists", () => {
    const content = readFileSync(configPath, "utf-8");
    expect(content).toBeTruthy();
  });

  it("config exports valid CI structure", async () => {
    config = (await import(configPath)).default;
    expect(config.ci).toBeDefined();
    expect(config.ci.collect).toBeDefined();
    expect(config.ci.assert).toBeDefined();
  });

  it("collect includes at least 4 URLs", () => {
    const urls = config.ci.collect.url;
    expect(urls.length).toBeGreaterThanOrEqual(15);
    expect(urls).toContain("http://localhost:4021/");
    expect(urls).toContain("http://localhost:4021/llms.txt");
  });

  it("asserts performance >= 0.95", () => {
    const perf = config.ci.assert.assertions["categories:performance"];
    expect(perf[0]).toBe("error");
    expect(perf[1].minScore).toBeGreaterThanOrEqual(0.95);
  });

  it("asserts accessibility = 1.0", () => {
    const a11y = config.ci.assert.assertions["categories:accessibility"];
    expect(a11y[0]).toBe("error");
    expect(a11y[1].minScore).toBe(1.0);
  });

  it("asserts best-practices = 1.0", () => {
    const bp = config.ci.assert.assertions["categories:best-practices"];
    expect(bp[0]).toBe("error");
    expect(bp[1].minScore).toBe(1.0);
  });

  it("asserts seo = 1.0", () => {
    const seo = config.ci.assert.assertions["categories:seo"];
    expect(seo[0]).toBe("error");
    expect(seo[1].minScore).toBe(1.0);
  });

  it("package.json has lighthouse script", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8"));
    expect(pkg.scripts.lighthouse).toBeDefined();
    expect(pkg.scripts.lighthouse).toContain("lhci");
  });
});
