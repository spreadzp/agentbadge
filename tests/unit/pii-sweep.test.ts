/**
 * SLICE-103-1: PII sweep tests.
 */

import { describe, it, expect } from "vitest";
import { sweepForPii } from "../../src/agent-readiness/corpus/pii-sweep";

describe("SLICE-103-1: pii-sweep", () => {
  it("returns clean=true for a valid anonymized record", () => {
    const record = {
      record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V0",
      timestamp: "2025-09-06T12:00:00Z",
      ruleset_version: "agent-readiness@1.2.0",
      scan_summary: { score: 72, grade: "B" },
      category_scores: { api_description: 85 },
    };
    const result = sweepForPii(record);
    expect(result.clean).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("detects URLs", () => {
    const result = sweepForPii({ ref: "https://api.example.com/v1" });
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.startsWith("URL:"))).toBe(true);
  });

  it("detects email addresses", () => {
    const result = sweepForPii({ contact: "admin@example.com" });
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.startsWith("email:"))).toBe(true);
  });

  it("detects IPv4 addresses", () => {
    const result = sweepForPii({ server: "192.168.1.1" });
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.startsWith("IPv4:"))).toBe(true);
  });

  it("detects IPv6 addresses", () => {
    const result = sweepForPii({ server: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" });
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.startsWith("IPv6:"))).toBe(true);
  });

  it("detects domain-like strings", () => {
    const result = sweepForPii({ target: "api.example.com" });
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.startsWith("domain:"))).toBe(true);
  });

  it("sweeps nested objects", () => {
    const result = sweepForPii({
      outer: { inner: { url: "https://secret.example.com" } },
    });
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.startsWith("URL:"))).toBe(true);
  });

  it("sweeps arrays", () => {
    const result = sweepForPii({ endpoints: ["https://a.example.com", "https://b.example.com"] });
    expect(result.clean).toBe(false);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag normal strings without PII", () => {
    const result = sweepForPii({ category: "api_description", grade: "B" });
    expect(result.clean).toBe(true);
  });

  it("does not flag ULID as PII", () => {
    const result = sweepForPii({ record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V0" });
    expect(result.clean).toBe(true);
  });

  it("does not flag ISO timestamp as PII", () => {
    const result = sweepForPii({ timestamp: "2025-09-06T12:00:00Z" });
    expect(result.clean).toBe(true);
  });

  it("handles null and undefined values", () => {
    const result = sweepForPii({ a: null, b: undefined, c: 42, d: true });
    expect(result.clean).toBe(true);
  });

  it("handles empty objects and arrays", () => {
    const result = sweepForPii({ empty_obj: {}, empty_arr: [] });
    expect(result.clean).toBe(true);
  });

  it("handles numbers and booleans (non-string)", () => {
    const result = sweepForPii({ score: 72, active: true, count: 0 });
    expect(result.clean).toBe(true);
  });
});
