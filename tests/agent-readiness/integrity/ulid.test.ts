import { describe, it, expect } from "vitest";
import { generateReportId } from "../../../src/agent-readiness/integrity/ulid";

describe("SLICE-36-3: ULID Report ID Generator", () => {
  it("returns a 26-character string", () => {
    const id = generateReportId();
    expect(id).toHaveLength(26);
  });

  it("output matches ULID regex /^[0-9A-HJKMNP-TV-Z]{26}$/", () => {
    const id = generateReportId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("two calls produce different IDs", () => {
    const id1 = generateReportId();
    const id2 = generateReportId();
    expect(id1).not.toBe(id2);
  });

  it("IDs are time-sortable (lexicographic = chronological)", () => {
    const id1 = generateReportId(1000);
    const id2 = generateReportId(2000);
    expect(id1 < id2).toBe(true);
  });

  it("no I/L/O/U characters in output", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateReportId();
      expect(id).not.toMatch(/[ILOU]/);
    }
  });

  it("same timestamp produces same time component (first 10 chars)", () => {
    const id1 = generateReportId(123456789);
    const id2 = generateReportId(123456789);
    expect(id1.slice(0, 10)).toBe(id2.slice(0, 10));
  });
});
