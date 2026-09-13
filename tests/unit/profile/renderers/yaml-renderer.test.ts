import { describe, it, expect } from "vitest";
import { renderProfileYaml } from "../../../../src/agent-readiness/profile/renderers/yaml-renderer";
import { buildProfile } from "../../../../src/agent-readiness/profile/profile-builder";
import { makeFixtureScanReport, makeFixtureAssertions } from "../fixtures/scan-report-fixture";
import * as yaml from "yaml";

/**
 * SLICE-101-7: YAML Renderer tests.
 */

function makeProfile() {
  return buildProfile({
    scanReport: makeFixtureScanReport(),
    assertions: makeFixtureAssertions(),
    reportId: "YAML-TEST",
  });
}

describe("SLICE-101-7: renderProfileYaml", () => {
  it("produces valid YAML that can be parsed back", () => {
    const profile = makeProfile();
    const yamlStr = renderProfileYaml(profile);
    const parsed = yaml.parse(yamlStr);
    expect(parsed).toBeDefined();
    expect(parsed.profile_version).toBe("1.0.0");
    expect(parsed.schema_version).toBe("0.9.0");
  });

  it("preserves service domain and base_url", () => {
    const yamlStr = renderProfileYaml(makeProfile());
    const parsed = yaml.parse(yamlStr);
    expect(parsed.service.domain).toBe("api.example.com");
    expect(parsed.service.base_url).toContain("https://api.example.com");
  });

  it("preserves readiness score and grade", () => {
    const yamlStr = renderProfileYaml(makeProfile());
    const parsed = yaml.parse(yamlStr);
    expect(parsed.readiness.score).toBeDefined();
    expect(parsed.readiness.grade).toBeDefined();
  });

  it("preserves freshness section", () => {
    const yamlStr = renderProfileYaml(makeProfile());
    const parsed = yaml.parse(yamlStr);
    expect(parsed.freshness).toBeDefined();
    expect(parsed.freshness.profile_generated_at).toBeDefined();
    expect(parsed.freshness.oldest_evidence_days).toBeDefined();
  });

  it("preserves evidence_summary", () => {
    const yamlStr = renderProfileYaml(makeProfile());
    const parsed = yaml.parse(yamlStr);
    expect(parsed.evidence_summary).toBeDefined();
    expect(parsed.evidence_summary.total_assertions).toBeGreaterThan(0);
  });

  it("contains same data as JSON", () => {
    const profile = makeProfile();
    const yamlStr = renderProfileYaml(profile);
    const parsed = yaml.parse(yamlStr);
    // Compare key fields
    expect(parsed.profile_version).toBe(profile.profile_version);
    expect(parsed.service.domain).toBe(profile.service.domain);
    expect(parsed.readiness.score).toBe(profile.readiness.score);
  });
});
