/**
 * SLICE-80-2: Centralized Title Composer — Single Brand Suffix
 *
 * Every PageMeta title must:
 * - Contain at most one "AgentBadge" occurrence
 * - Not end with em-dash brand suffix ("— AgentBadge")
 * - When composed with pageTitle(), produce ≤ 72 chars with single brand
 */
import { describe, it, expect } from "bun:test";
import { PageMeta, pageTitle, SITE_NAME } from "../../src/server/lib/page-meta";

describe("SLICE-80-2: Title composer — single brand suffix", () => {
  for (const [path, meta] of Object.entries(PageMeta)) {
    it(`PageMeta["${path}"].title has at most one "AgentBadge"`, () => {
      const brandCount = (meta.title.match(/AgentBadge/gi) ?? []).length;
      expect(brandCount).toBeLessThanOrEqual(1);
    });

    it(`PageMeta["${path}"].title does not end with em-dash brand suffix`, () => {
      expect(meta.title).not.toMatch(/—\s*AgentBadge$/);
    });
  }

  it("pageTitle() composes with pipe separator and single brand", () => {
    const result = pageTitle("Pricing");
    expect(result).toBe("Pricing | AgentBadge");
    expect(result).not.toContain("—");
  });

  it("pageTitle() caps unique part at 60 chars", () => {
    const longTitle = "A".repeat(80);
    const result = pageTitle(longTitle);
    expect(result.length).toBeLessThanOrEqual(72);
    expect(result).toContain("AgentBadge");
  });

  it("pageTitle() deduplicates brand if unique part already contains it", () => {
    const result = pageTitle("About AgentBadge");
    expect(result).toBe("About | AgentBadge");
    expect((result.match(/AgentBadge/gi) ?? []).length).toBe(1);
  });

  it("pageTitle() handles empty string gracefully", () => {
    const result = pageTitle("");
    expect(result).toContain(SITE_NAME);
    expect((result.match(/AgentBadge/gi) ?? []).length).toBe(1);
  });

  it("all PageMeta titles composed via pageTitle() are ≤ 72 chars", () => {
    for (const [path, meta] of Object.entries(PageMeta)) {
      const composed = pageTitle(meta.title);
      expect(
        composed.length,
        `pageTitle("${meta.title}") = "${composed}" (${composed.length} chars) for ${path}`,
      ).toBeLessThanOrEqual(72);
    }
  });

  it("all PageMeta titles composed via pageTitle() have single brand", () => {
    for (const [path, meta] of Object.entries(PageMeta)) {
      const composed = pageTitle(meta.title);
      const brandCount = (composed.match(/AgentBadge/gi) ?? []).length;
      expect(brandCount, `${path}: "${composed}" has ${brandCount} brand occurrences`).toBe(1);
    }
  });
});
