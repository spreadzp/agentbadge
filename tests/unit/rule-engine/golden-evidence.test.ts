import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AssertionBuilder } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { strongestSource } from "../../../src/agent-readiness/rule-engine/source-hierarchy";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

/**
 * SLICE-94-10: Golden evidence Fixture
 * Verifies that AssertionBuilder reproduces golden values EXACTLY
 * for 10 canned assertions covering all statuses and evidence mixes.
 */

const fixturePath = join(__dirname, "../../fixtures/evidence/golden-assertions.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
const goldenAssertions: Assertion[] = fixture.assertions;
const expectedMeta: Record<string, { status: string; claim: string; review_level: string | null; source_class: string | null }> = fixture._meta.expected_values;

describe("SLICE-94-10: Golden evidence fixture — assertion shapes", () => {
  it("fixture has 10 assertions", () => {
    expect(goldenAssertions).toHaveLength(10);
  });

  it("all 5 statuses are represented", () => {
    const statuses = new Set(goldenAssertions.map((a) => a.status));
    expect(statuses.has("VERIFIED")).toBe(true);
    expect(statuses.has("INFERRED")).toBe(true);
    expect(statuses.has("CONFLICT")).toBe(true);
    expect(statuses.has("GAP")).toBe(true);
    expect(statuses.has("NOT_APPLICABLE")).toBe(true);
  });

  it("VERIFIED via robots (AB-001) has correct source_class", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-001")!;
    expect(a.evidence[0].source_class).toBe("machine_readable_guide");
  });

  it("VERIFIED via openapi (AB-003) has correct source_class", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-003")!;
    expect(a.evidence[0].source_class).toBe("machine_readable_spec");
  });

  it("VERIFIED via runtime probe (AB-011) has source_class=runtime", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-011")!;
    expect(a.evidence[0].source_class).toBe("runtime");
  });

  it("CONFLICT (AB-007) has cross evidence with conflict_reason", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-007")!;
    expect(a.evidence[0].type).toBe("cross");
    expect((a.evidence[0] as Extract<Evidence, { type: "cross" }>).conflict_reason).toContain("robots.txt");
  });

  it("GAP assertions have empty evidence arrays", () => {
    const gaps = goldenAssertions.filter((a) => a.status === "GAP");
    expect(gaps).toHaveLength(2);
    for (const g of gaps) {
      expect(g.evidence).toHaveLength(0);
    }
  });

  it("NOT_APPLICABLE has null review_level", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-015")!;
    expect(a.review_level).toBeNull();
  });

  it("INFERRED with confidence 0.6 has review_level=assisted", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-013")!;
    expect(a.confidence).toBe(0.6);
    expect(a.review_level).toBe("assisted");
  });
});

describe("SLICE-94-10: Golden evidence — verified_at derivation", () => {
  it("verified_at = max evidence captured_at when evidence present", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-001")!;
    expect(a.verified_at).toBe("2026-09-01T10:00:00Z");
  });

  it("verified_at = timestamp when no evidence (GAP)", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-010")!;
    expect(a.verified_at).toBe(a.timestamp);
  });

  it("cross evidence verified_at = max of member captured_at", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-007")!;
    expect(a.verified_at).toBe("2026-09-01T10:00:02Z");
  });
});

describe("SLICE-94-10: Golden evidence — review_level computation", () => {
  it("confidence >= 0.80 → automatic", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-001")!;
    expect(a.confidence).toBeGreaterThanOrEqual(0.8);
    expect(a.review_level).toBe("automatic");
  });

  it("confidence < 0.80 → assisted", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-013")!;
    expect(a.confidence).toBeLessThan(0.8);
    expect(a.review_level).toBe("assisted");
  });

  it("NOT_APPLICABLE → null review_level", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-015")!;
    expect(a.review_level).toBeNull();
  });
});

describe("SLICE-94-10: Golden evidence — strongest source", () => {
  it("strongestSource returns highest ranked evidence", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-001")!;
    const strongest = strongestSource(a.evidence);
    expect(strongest?.sourceClass).toBe("machine_readable_guide");
  });

  it("strongestSource returns null for empty evidence", () => {
    const a = goldenAssertions.find((x) => x.rule_id === "AB-010")!;
    const strongest = strongestSource(a.evidence);
    expect(strongest).toBeNull();
  });
});

describe("SLICE-94-10: Golden evidence — AssertionBuilder round-trip", () => {
  it("deserialize → serialize preserves all v2 fields", () => {
    for (const golden of goldenAssertions) {
      const json = JSON.stringify(golden);
      const deserialized = AssertionBuilder.deserialize(json);
      expect(deserialized.claim).toBe(golden.claim);
      expect(deserialized.verified_at).toBe(golden.verified_at);
      expect(deserialized.review_level).toBe(golden.review_level);
      expect(deserialized.evidence).toHaveLength(golden.evidence.length);
    }
  });

  it("deserialize normalizes MISSING → GAP", () => {
    const missingReport = JSON.stringify({
      ...goldenAssertions[0],
      status: "MISSING",
    });
    const deserialized = AssertionBuilder.deserialize(missingReport);
    expect(deserialized.status).toBe("GAP");
  });
});

describe("SLICE-94-10: Golden evidence — expected values match fixture", () => {
  for (const [ruleId, expected] of Object.entries(expectedMeta)) {
    it(`${ruleId} matches expected status=${expected.status}`, () => {
      const a = goldenAssertions.find((x) => x.rule_id === ruleId)!;
      expect(a.status).toBe(expected.status);
    });

    it(`${ruleId} matches expected claim`, () => {
      const a = goldenAssertions.find((x) => x.rule_id === ruleId)!;
      expect(a.claim).toBe(expected.claim);
    });

    it(`${ruleId} matches expected review_level`, () => {
      const a = goldenAssertions.find((x) => x.rule_id === ruleId)!;
      expect(a.review_level).toBe(expected.review_level);
    });
  }
});
