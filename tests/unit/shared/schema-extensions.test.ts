import { describe, it, expect } from "vitest";
import { categoryEnum, funnelStageSchema, funnelResultSchema } from "../../../src/agent-readiness/shared.schema";

describe("schema extensions for EPIC-87", () => {
  it("categoryEnum includes active_probing", () => {
    const result = categoryEnum.safeParse("active_probing");
    expect(result.success).toBe(true);
  });

  it("funnelStageSchema validates correctly", () => {
    const stage = {
      name: "Discovery",
      categories: ["discovery", "agents_txt"],
      score: 80,
      passRate: 0.8,
    };
    const result = funnelStageSchema.safeParse(stage);
    expect(result.success).toBe(true);
  });

  it("funnelResultSchema validates correctly", () => {
    const funnel = {
      stages: [
        { name: "Discovery", categories: ["discovery"], score: 100, passRate: 1.0 },
        { name: "Spec Parsed", categories: ["openapi"], score: 50, passRate: 0.5 },
      ],
      dropOff: [50],
    };
    const result = funnelResultSchema.safeParse(funnel);
    expect(result.success).toBe(true);
  });

  it("funnelStageSchema rejects invalid data", () => {
    const invalid = { name: 123, categories: "not-array" };
    const result = funnelStageSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
