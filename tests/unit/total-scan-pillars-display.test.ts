import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("SLICE-93-8: Four Pillars results UI", () => {
  it("scanner page renderReport contains pillar rendering code", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // The renderReport function must reference pillars and renderPillarRow
    expect(html).toContain("pillars");
    expect(html).toContain("renderPillarRow");
    expect(html).toContain("pillar.label");
    expect(html).toContain("pillar.score");
    expect(html).toContain("pillar.weight");
  });

  it("scanner page has pillar weight-scaled score rendering (NN/weight)", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // Weight-scaled score: scaled = score * weight / 100, rendered as scaled/weight
    expect(html).toContain("pillar.weight");
    expect(html).toContain("pillar.score");
    expect(html).toContain("Math.round");
  });

  it("scanner page has pillar question tooltips", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // pillar.question is rendered as tooltip text in the pillar row
    expect(html).toContain("pillar.question");
    expect(html).toContain("title=");
  });

  it("scanner page has floor warning rendering", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("floorTriggered");
    expect(html).toContain("floorReason");
  });

  it("scanner page has issue bucket rendering (Critical/High/Medium/Low)", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("CRITICAL");
    expect(html).toContain("HIGH");
    expect(html).toContain("MEDIUM");
    expect(html).toContain("LOW");
  });

  it("scanner page has graceful degradation for missing pillars", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // Must check for pillars existence before rendering
    expect(html).toContain("report.pillars");
  });

  it("scanner page has expandable pillar categories", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // Pillar rows should be expandable to show member categories
    expect(html).toContain("pillar-categories");
    expect(html).toContain("toggle");
  });

  it("scanner page still has legacy rendering (categories, top_missing)", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // Legacy rendering must still be present for backward compat
    expect(html).toContain("Category Breakdown");
    expect(html).toContain("top_missing");
    expect(html).toContain("Top Issues");
  });
});
