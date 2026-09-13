import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { COMPARISON_PAGES } from "../../../src/server/lib/comparison-data";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "..", "..", "..", "src", "server", "comparison-content");

describe("SLICE-117-2: comparison content markdown files", () => {
  for (const page of COMPARISON_PAGES) {
    const filePath = join(contentDir, `${page.slug}.md`);

    it(`file exists for ${page.slug}`, () => {
      expect(existsSync(filePath)).toBe(true);
    });

    it(`${page.slug}.md contains "## Where They Overlap" heading`, () => {
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("## Where They Overlap");
    });

    it(`${page.slug}.md contains "## Where They Differ" heading`, () => {
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("## Where They Differ");
    });

    it(`${page.slug}.md contains "## Use Case Matrix" heading`, () => {
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("## Use Case Matrix");
    });

    it(`${page.slug}.md is > 200 bytes`, () => {
      const stat = readFileSync(filePath);
      expect(stat.length).toBeGreaterThan(200);
    });
  }
});
