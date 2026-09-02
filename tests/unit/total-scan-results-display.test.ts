import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("SLICE-58-8: Total scan results display", () => {
  it("scanner page has SSE client JS for total-scan", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("total-scan-form");
    expect(html).toContain("fetch('/api/total-scan'");
    expect(html).toContain("getReader");
  });

  it("scanner page has renderReport function", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("renderReport");
    expect(html).toContain("score");
    expect(html).toContain("grade");
    expect(html).toContain("categories");
    expect(html).toContain("top_missing");
  });

  it("scanner page has progress text updates", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("Fetching resources");
    expect(html).toContain("Evaluating rules");
  });

  it("scanner page has error handling", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("catch");
    expect(html).toContain("Error:");
  });

  it("scanner page re-enables submit button after scan", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("finally");
    expect(html).toContain("Start Full Scan");
  });

  it("passport page does not have total-scan JS", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).not.toContain("total-scan-form");
    expect(html).not.toContain("renderReport");
  });
});

// ─── SLICE-94-8: Evidence Drawer ──────────────────────────────────────────────

describe("SLICE-94-8: Evidence drawer in scan results UI", () => {
  it("scanner page has renderEvidenceDrawer function", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("renderEvidenceDrawer");
  });

  it("drawer renders claim for VERIFIED assertions", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("claim");
    expect(html).toContain("blockquote");
  });

  it("drawer renders source_label badge", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("source_label");
  });

  it("drawer renders confidence percentage", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("confidence");
    expect(html).toContain("Math.round");
  });

  it("drawer renders review_level chip (automatic/assisted)", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("review_level");
    expect(html).toContain("automatic");
    expect(html).toContain("assisted");
  });

  it("drawer renders verified_at timestamp", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("verified_at");
  });

  it("drawer renders stale marker when stale flag is set", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("stale");
    expect(html).toContain("⚠");
  });

  it("drawer renders evidence summaries with captured_at", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("evidence");
    expect(html).toContain("captured_at");
    expect(html).toContain("summary");
  });

  it("drawer renders GAP no-evidence state explicitly", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("No evidence found");
  });

  it("drawer renders GAP narrative wording", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("information gap");
    expect(html).toContain("agents cannot answer");
  });

  it("drawer has graceful degradation for legacy assertions (no undefined/NaN)", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // Legacy fallback: check for safe accessors that avoid undefined
    expect(html).toContain("|| ''");
    expect(html).toContain("|| 'unknown'");
  });

  it("assertion rows are clickable to toggle drawer", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // The drawer toggle mechanism must be present
    expect(html).toContain("toggle");
    expect(html).toContain("drawer");
  });

  it("assertions array is rendered in the report output", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("assertions");
    expect(html).toContain("renderAssertionList");
  });
});
