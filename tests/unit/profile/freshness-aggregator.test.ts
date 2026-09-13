import { describe, it, expect } from "vitest";
import { aggregateFreshness, isSectionStale, ageInDays, FRESHNESS_THRESHOLDS } from "../../../src/agent-readiness/profile/freshness-aggregator";

/**
 * SLICE-101-6: Freshness Aggregator tests.
 */

describe("SLICE-101-6: ageInDays", () => {
  it("computes age from recent timestamp", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const ts = "2026-08-31T10:00:00Z";
    expect(ageInDays(ts, now)).toBe(1);
  });

  it("computes age from old timestamp", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const ts = "2026-07-01T10:00:00Z";
    expect(ageInDays(ts, now)).toBe(62);
  });

  it("returns 0 for invalid timestamp", () => {
    expect(ageInDays("invalid")).toBe(0);
  });
});

describe("SLICE-101-6: isSectionStale", () => {
  it("not stale when within threshold", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const ts = "2026-08-20T10:00:00Z"; // 12 days ago
    expect(isSectionStale(ts, ["website_content"], now)).toBe(false); // threshold 14
  });

  it("stale when exceeds threshold", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const ts = "2026-08-10T10:00:00Z"; // 22 days ago
    expect(isSectionStale(ts, ["website_content"], now)).toBe(true); // threshold 14
  });

  it("uses machine_readable_spec threshold (30 days)", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const ts = "2026-08-10T10:00:00Z"; // 22 days
    expect(isSectionStale(ts, ["machine_readable_spec"], now)).toBe(false);
    const ts2 = "2026-07-15T10:00:00Z"; // 48 days
    expect(isSectionStale(ts2, ["machine_readable_spec"], now)).toBe(true);
  });

  it("uses default 30 days for unknown source class", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const ts = "2026-08-01T10:00:00Z"; // 31 days
    expect(isSectionStale(ts, ["unknown_class"], now)).toBe(true);
  });
});

describe("SLICE-101-6: aggregateFreshness", () => {
  it("computes oldest_evidence_days across sections", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const sections = [
      { name: "capabilities", verified_at: "2026-08-31T10:00:00Z", source_class: "machine_readable_spec" },
      { name: "auth", verified_at: "2026-08-15T10:00:00Z", source_class: "website_content" },
    ];
    const result = aggregateFreshness(sections, now);
    expect(result.oldest_evidence_days).toBe(17); // Aug 15 → Sep 1
  });

  it("lists stale sections", () => {
    const now = new Date("2026-09-01T10:00:00Z");
    const sections = [
      { name: "capabilities", verified_at: "2026-08-31T10:00:00Z", source_class: "machine_readable_spec" },
      { name: "auth", verified_at: "2026-07-01T10:00:00Z", source_class: "website_content" }, // 62 days, stale
    ];
    const result = aggregateFreshness(sections, now);
    expect(result.stale_sections).toContain("auth");
    expect(result.stale_sections).not.toContain("capabilities");
  });

  it("empty sections → zero oldest, no stale", () => {
    const result = aggregateFreshness([]);
    expect(result.oldest_evidence_days).toBe(0);
    expect(result.stale_sections).toEqual([]);
  });
});

describe("SLICE-101-6: FRESHNESS_THRESHOLDS", () => {
  it("has expected thresholds", () => {
    expect(FRESHNESS_THRESHOLDS.machine_readable_spec).toBe(30);
    expect(FRESHNESS_THRESHOLDS.website_content).toBe(14);
    expect(FRESHNESS_THRESHOLDS.official_docs).toBe(60);
    expect(FRESHNESS_THRESHOLDS.runtime).toBe(7);
  });
});
