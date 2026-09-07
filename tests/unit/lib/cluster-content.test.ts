import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CLUSTER_PAGES } from "../../../src/server/lib/cluster-data";

const CONTENT_DIR = join(process.cwd(), "src/server/cluster-content");

describe("SLICE-116-2: Cluster content markdown files", () => {
  for (const page of CLUSTER_PAGES) {
    const filename = page.contentFile.split("/").pop()!;
    const filepath = join(CONTENT_DIR, filename);

    it(`${filename} exists`, () => {
      expect(existsSync(filepath)).toBe(true);
    });

    it(`${filename} contains ## Explanation heading`, () => {
      const content = readFileSync(filepath, "utf-8");
      expect(content).toContain("## Explanation");
    });

    it(`${filename} contains ## Example heading`, () => {
      const content = readFileSync(filepath, "utf-8");
      expect(content).toContain("## Example");
    });

    it(`${filename} is > 200 bytes`, () => {
      const stat = readFileSync(filepath);
      expect(stat.length).toBeGreaterThan(200);
    });
  }
});
