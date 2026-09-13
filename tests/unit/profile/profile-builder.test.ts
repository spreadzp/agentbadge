import { describe, it, expect } from "vitest";
import { buildProfile } from "../../../src/agent-readiness/profile/profile-builder";
import { parseDomain } from "../../../src/agent-readiness/profile/domain-parser";
import { makeFixtureScanReport, makeFixtureAssertions } from "./fixtures/scan-report-fixture";

/**
 * SLICE-101-2: Profile Builder Core tests.
 */

describe("SLICE-101-2: parseDomain", () => {
  it("extracts hostname from https URL", () => {
    expect(parseDomain("https://api.example.com/v1/tasks")).toBe("api.example.com");
  });

  it("extracts hostname from http URL", () => {
    expect(parseDomain("http://api.example.com")).toBe("api.example.com");
  });

  it("handles localhost with port", () => {
    expect(parseDomain("http://localhost:3000/api")).toBe("localhost");
  });

  it("handles URL without protocol", () => {
    expect(parseDomain("api.example.com/path")).toBe("api.example.com");
  });

  it("handles URL with trailing path", () => {
    expect(parseDomain("https://api.example.com/")).toBe("api.example.com");
  });
});

describe("SLICE-101-2: buildProfile — service section", () => {
  it("parses domain from scanReport.url", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.service.domain).toBe("api.example.com");
  });

  it("sets base_url to scanReport.url", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.service.base_url).toBe("https://api.example.com");
  });

  it("sets name from first VERIFIED discovery assertion", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.service.name).toBe("API Discovery");
  });

  it("falls back to domain when no VERIFIED discovery assertion", () => {
    const assertions = makeFixtureAssertions().filter(
      (a) => !(a.category === "discovery" && a.status === "VERIFIED"),
    );
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions,
    });
    expect(profile.service.name).toBe("api.example.com");
  });

  it("sets description from scanReport.summary", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.service.description).toContain("OpenAPI spec");
  });

  it("sets verified_at to latest assertion timestamp", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.service.verified_at).toBe("2026-09-01T10:00:00Z");
  });

  it("sets scan_id from reportId", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "01HXY-TEST",
    });
    expect(profile.service.scan_id).toBe("01HXY-TEST");
  });

  it("generates scan_id when reportId not provided", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.service.scan_id).toBeDefined();
    expect(profile.service.scan_id).toContain("profile-");
  });
});

describe("SLICE-101-2: buildProfile — readiness section", () => {
  it("sets score and grade from scanReport", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.readiness.score).toBe(78);
    expect(profile.readiness.grade).toBe("B");
  });

  it("sets verified_rules from scanReport.verified", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.readiness.verified_rules).toBe(32);
  });

  it("sets total_rules from scanReport.total_rules", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.readiness.total_rules).toBe(40);
  });

  it("sets gaps from scanReport.missing", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.readiness.gaps).toBe(6);
  });

  it("counts conflicts from assertions", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.readiness.conflicts).toBe(1);
  });

  it("sets categories from scanReport.categories (completeness_pct)", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.readiness.categories.discovery).toBe(80);
    expect(profile.readiness.categories.documentation).toBe(87);
  });
});

describe("SLICE-101-2: buildProfile — evidence_summary section", () => {
  it("counts total_assertions", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.evidence_summary.total_assertions).toBe(makeFixtureAssertions().length);
  });

  it("counts by_status correctly", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    const byStatus = profile.evidence_summary.by_status;
    expect(byStatus.VERIFIED).toBeGreaterThan(0);
    expect(byStatus.GAP).toBeGreaterThan(0);
    expect(byStatus.CONFLICT).toBe(1);
    expect(byStatus.NOT_APPLICABLE).toBe(1);
    expect(byStatus.INFERRED).toBe(1);
  });

  it("computes confidence_range", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    const range = profile.evidence_summary.confidence_range;
    expect(range.min).toBeGreaterThanOrEqual(0);
    expect(range.max).toBeLessThanOrEqual(1);
    expect(range.mean).toBeGreaterThan(0);
    expect(range.mean).toBeLessThan(1);
  });
});

describe("SLICE-101-2: buildProfile — freshness section", () => {
  it("sets profile_generated_at", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.freshness.profile_generated_at).toBeDefined();
    expect(profile.freshness.profile_generated_at).toContain("2026");
  });

  it("computes oldest_evidence_days", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.freshness.oldest_evidence_days).toBeGreaterThanOrEqual(0);
  });

  it("stale_sections is empty", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.freshness.stale_sections).toEqual([]);
  });
});

describe("SLICE-101-2: buildProfile — optional sections undefined when no applicable assertions", () => {
  // Use assertions with categories not mapped to any section (infrastructure, seo_aeo, versioning)
  const unmappedAssertions = makeFixtureAssertions().map((a) => ({
    ...a,
    category: a.category === "discovery" ? "infrastructure" : a.category === "documentation" ? "seo_aeo" : a.category === "openapi" ? "versioning" : a.category === "bot_auth" ? "infrastructure" : a.category === "identity" ? "seo_aeo" : a.category === "pricing" ? "infrastructure" : a.category === "payments" ? "versioning" : a.category === "rate_limits" ? "seo_aeo" : a.category === "error_semantics" ? "infrastructure" : a.category === "agent_policy" ? "versioning" : a.category === "agents_txt" ? "seo_aeo" : a.category === "sandbox" ? "versioning" : a.category,
  }));

  it("capabilities is undefined", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: unmappedAssertions,
    });
    expect(profile.capabilities).toBeUndefined();
  });

  it("auth is undefined", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: unmappedAssertions,
    });
    expect(profile.auth).toBeUndefined();
  });

  it("pricing is undefined", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: unmappedAssertions,
    });
    expect(profile.pricing).toBeUndefined();
  });

  it("limits is undefined", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: unmappedAssertions,
    });
    expect(profile.limits).toBeUndefined();
  });

  it("errors is undefined", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: unmappedAssertions,
    });
    expect(profile.errors).toBeUndefined();
  });

  it("policies is undefined", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: unmappedAssertions,
    });
    expect(profile.policies).toBeUndefined();
  });
});

describe("SLICE-101-2: buildProfile — pure function property", () => {
  it("same input → same output (ignoring generated_at and scan_id)", () => {
    const input = {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "FIXED-ID",
    };
    const p1 = buildProfile(input);
    const p2 = buildProfile(input);
    // service, readiness, evidence_summary should be identical
    expect(p1.service.domain).toBe(p2.service.domain);
    expect(p1.service.name).toBe(p2.service.name);
    expect(p1.readiness.score).toBe(p2.readiness.score);
    expect(p1.evidence_summary.total_assertions).toBe(p2.evidence_summary.total_assertions);
    expect(p1.evidence_summary.by_status).toEqual(p2.evidence_summary.by_status);
  });

  it("does not mutate input", () => {
    const scanReport = makeFixtureScanReport();
    const assertions = makeFixtureAssertions();
    const scanReportCopy = JSON.parse(JSON.stringify(scanReport));
    const assertionsCopy = JSON.parse(JSON.stringify(assertions));

    buildProfile({ scanReport, assertions, reportId: "TEST" });

    expect(scanReport).toEqual(scanReportCopy);
    expect(assertions).toEqual(assertionsCopy);
  });
});

describe("SLICE-101-2: buildProfile — profile version + schema version", () => {
  it("sets profile_version to 1.0.0", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.profile_version).toBe("1.0.0");
  });

  it("sets schema_version to 0.9.0", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
    });
    expect(profile.schema_version).toBe("0.9.0");
  });
});
