import { describe, it, expect } from "vitest";
import {
  allVerified,
  allMissing,
  floorTriggered,
  mixedStatus,
  deltaPrevious,
  deltaCurrent,
  emptyAssertions,
  allNotApplicable,
  singleAssertion,
} from "../../fixtures/scoring";

describe("SLICE-35-8: Scoring Fixtures", () => {
  it("all-verified fixture has 13 assertions, all VERIFIED", () => {
    expect(allVerified).toHaveLength(13);
    expect(allVerified.every((a) => a.status === "VERIFIED")).toBe(true);
  });

  it("all-missing fixture has 13 assertions, all MISSING", () => {
    expect(allMissing).toHaveLength(13);
    expect(allMissing.every((a) => a.status === "MISSING")).toBe(true);
  });

  it("floor-triggered fixture has AB-003 as MISSING in discovery high", () => {
    expect(floorTriggered).toHaveLength(13);
    const ab003 = floorTriggered.find((a) => a.rule_id === "AB-003");
    expect(ab003?.status).toBe("MISSING");
    expect((ab003 as any).category).toBe("discovery");
    expect((ab003 as any).severity).toBe("high");
  });

  it("mixed-status fixture has varied statuses", () => {
    expect(mixedStatus).toHaveLength(13);
    const statuses = new Set(mixedStatus.map((a) => a.status));
    expect(statuses.has("VERIFIED")).toBe(true);
    expect(statuses.has("INFERRED")).toBe(true);
    expect(statuses.has("CONFLICT")).toBe(true);
    expect(statuses.has("MISSING")).toBe(true);
    expect(statuses.has("NOT_APPLICABLE")).toBe(true);
  });

  it("delta fixtures have matching rule_ids", () => {
    expect(deltaPrevious).toHaveLength(13);
    expect(deltaCurrent).toHaveLength(13);
    const prevIds = new Set(deltaPrevious.map((a) => a.rule_id));
    const currIds = new Set(deltaCurrent.map((a) => a.rule_id));
    expect(prevIds).toEqual(currIds);
  });

  it("delta: AB-001 MISSING→VERIFIED, AB-004 VERIFIED→MISSING, AB-009 INFERRED→VERIFIED", () => {
    const ab001prev = deltaPrevious.find((a) => a.rule_id === "AB-001");
    const ab001curr = deltaCurrent.find((a) => a.rule_id === "AB-001");
    expect(ab001prev?.status).toBe("MISSING");
    expect(ab001curr?.status).toBe("VERIFIED");

    const ab004prev = deltaPrevious.find((a) => a.rule_id === "AB-004");
    const ab004curr = deltaCurrent.find((a) => a.rule_id === "AB-004");
    expect(ab004prev?.status).toBe("VERIFIED");
    expect(ab004curr?.status).toBe("MISSING");

    const ab009prev = deltaPrevious.find((a) => a.rule_id === "AB-009");
    const ab009curr = deltaCurrent.find((a) => a.rule_id === "AB-009");
    expect(ab009prev?.status).toBe("INFERRED");
    expect(ab009curr?.status).toBe("VERIFIED");
  });

  it("empty assertions fixture is empty array", () => {
    expect(emptyAssertions).toHaveLength(0);
  });

  it("all-not-applicable fixture has all NOT_APPLICABLE", () => {
    expect(allNotApplicable.every((a) => a.status === "NOT_APPLICABLE")).toBe(true);
  });

  it("single assertion fixture has 1 assertion", () => {
    expect(singleAssertion).toHaveLength(1);
  });

  it("all fixtures have valid rule_id, rule_version, timestamp", () => {
    const all = [
      ...allVerified,
      ...allMissing,
      ...floorTriggered,
      ...mixedStatus,
      ...deltaPrevious,
      ...deltaCurrent,
      ...allNotApplicable,
      ...singleAssertion,
    ];
    for (const a of all) {
      expect(a.rule_id).toMatch(/^AB-\d{3}$/);
      expect(a.rule_version).toBe("1.0.0");
      expect(a.timestamp).toBeTruthy();
    }
  });
});
