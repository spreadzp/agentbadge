import { describe, it, expect } from "vitest";
import { renderProfileMarkdown } from "../../../../src/agent-readiness/profile/renderers/markdown-renderer";
import { buildProfile } from "../../../../src/agent-readiness/profile/profile-builder";
import { makeFixtureScanReport, makeFixtureAssertions } from "../fixtures/scan-report-fixture";

/**
 * SLICE-101-7: Markdown Renderer tests.
 */

function makeProfile() {
  return buildProfile({
    scanReport: makeFixtureScanReport(),
    assertions: makeFixtureAssertions(),
    reportId: "MD-TEST",
  });
}

describe("SLICE-101-7: renderProfileMarkdown", () => {
  it("renders header with profile name and domain", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("# Knowledge Profile:");
    expect(md).toContain("api.example.com");
  });

  it("renders profile_version and schema_version", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("1.0.0");
    expect(md).toContain("0.9.0");
  });

  it("renders readiness section with score and grade", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("## Readiness");
    expect(md).toContain("**Score**");
    expect(md).toContain("**Grade**");
  });

  it("renders readiness category table", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("| Category | Score |");
  });

  it("renders content sections when populated", () => {
    const md = renderProfileMarkdown(makeProfile());
    // At least some sections should be present
    expect(md).toContain("## Capabilities");
  });

  it("renders section meta (source, confidence, verified_at, stale)", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("**Source**");
    expect(md).toContain("**Confidence**");
    expect(md).toContain("**Verified at**");
    expect(md).toContain("**Stale**");
  });

  it("renders freshness section", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("## Freshness");
    expect(md).toContain("Profile generated at");
    expect(md).toContain("Oldest evidence");
  });

  it("renders evidence summary with status table", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("## Evidence Summary");
    expect(md).toContain("### By Status");
    expect(md).toContain("| Status | Count |");
  });

  it("renders confidence range", () => {
    const md = renderProfileMarkdown(makeProfile());
    expect(md).toContain("Confidence range");
    expect(md).toContain("min=");
    expect(md).toContain("max=");
  });

  it("omits undefined sections", () => {
    const profile = makeProfile();
    // If auth is undefined, it should not appear
    if (!profile.auth) {
      const md = renderProfileMarkdown(profile);
      expect(md).not.toContain("## Auth");
    }
  });
});
