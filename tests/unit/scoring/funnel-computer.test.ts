import { describe, it, expect } from "vitest";
import { computeFunnel, FUNNEL_STAGES } from "../../../src/agent-readiness/scoring/funnel-computer";

describe("funnel-computer", () => {
  it("exports 6 funnel stages", () => {
    expect(FUNNEL_STAGES).toHaveLength(6);
    expect(FUNNEL_STAGES[0].name).toBe("Discovery");
    expect(FUNNEL_STAGES[5].name).toBe("Evidence");
  });

  it("computes per-stage pass rates from category scores", () => {
    const categoryScores = {
      discovery: 90,
      agents_txt: 80,
      ai_sitemap: 70,
      openapi: 60,
      machine_readable: 50,
      bot_auth: 40,
      identity: 30,
      documentation: 20,
      actionability: 10,
      verification: 0,
    };
    const funnel = computeFunnel(categoryScores);
    expect(funnel.stages).toHaveLength(6);
    expect(funnel.stages[0].score).toBe(80); // avg(90,80,70)
    expect(funnel.stages[0].passRate).toBe(0.8);
    expect(funnel.stages[1].score).toBe(55); // avg(60,50)
    expect(funnel.stages[1].passRate).toBe(0.55);
  });

  it("computes drop-off between stages", () => {
    const categoryScores = {
      discovery: 100,
      agents_txt: 100,
      ai_sitemap: 100,
      openapi: 50,
      machine_readable: 50,
      bot_auth: 0,
      identity: 0,
      documentation: 0,
      actionability: 0,
      verification: 0,
    };
    const funnel = computeFunnel(categoryScores);
    expect(funnel.stages[0].score).toBe(100);
    expect(funnel.stages[1].score).toBe(50);
    expect(funnel.dropOff[0]).toBe(50); // 100 → 50 = 50% drop-off
  });

  it("handles missing categories gracefully", () => {
    const categoryScores = { discovery: 100 };
    const funnel = computeFunnel(categoryScores);
    expect(funnel.stages).toHaveLength(6);
    expect(funnel.stages[1].score).toBe(0);
  });
});
