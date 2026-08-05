import { describe, it, expect } from "vitest";
import { agentReadinessReportSchema } from "../src/agent-readiness/report.schema";
import { cleanReport } from "./fixtures/agent-readiness-report-clean";
import { problemReport } from "./fixtures/agent-readiness-report-problem";

describe("agentReadinessReportSchema", () => {
  it("validates clean report fixture", () => {
    const result = agentReadinessReportSchema.safeParse(cleanReport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assertions).toHaveLength(13);
      expect(result.data.score.total).toBe(82);
    }
  });

  it("validates problem report fixture", () => {
    const result = agentReadinessReportSchema.safeParse(problemReport);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assertions).toHaveLength(13);
      const ab007 = result.data.assertions.find((a) => a.rule_id === "AB-007");
      expect(ab007?.status).toBe("CONFLICT");
      expect(ab007?.conflict?.sides).toHaveLength(2);
    }
  });

  it("rejects non-ULID report_id", () => {
    const bad = { ...cleanReport, report_id: "not-a-ulid" };
    const result = agentReadinessReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("report_id");
    }
  });

  it("rejects wrong schema_version", () => {
    const bad = { ...cleanReport, schema_version: "0.2.0" };
    const result = agentReadinessReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts empty assertions array", () => {
    const minimal = { ...cleanReport, assertions: [] };
    const result = agentReadinessReportSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("rejects bad rule_id in assertion", () => {
    const bad = {
      ...cleanReport,
      assertions: [
        {
          ...cleanReport.assertions[0],
          rule_id: "XY-001",
        },
      ],
    };
    const result = agentReadinessReportSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
