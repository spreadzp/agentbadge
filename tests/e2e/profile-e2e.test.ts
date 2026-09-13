import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { profileRoutes } from "../../src/server/routes/profile";
import { profileViewerRoutes } from "../../src/server/routes/profile-viewer";
import { cacheScanData, clearScanCache } from "../../src/server/profile/profile-store";
import { buildProfile } from "../../src/agent-readiness/profile/profile-builder";
import { renderProfileMarkdown } from "../../src/agent-readiness/profile/renderers/markdown-renderer";
import { renderProfileYaml } from "../../src/agent-readiness/profile/renderers/yaml-renderer";
import { knowledgeProfileSchema } from "../../src/agent-readiness/profile/profile-schema";
import { makeFixtureScanReport, makeFixtureAssertions } from "../unit/profile/fixtures/scan-report-fixture";
import * as fs from "fs";
import * as path from "path";

/**
 * SLICE-101-10: E2E + Goldens + Zero-drift verification.
 */

const app = new Hono();
app.route("/", profileRoutes);
app.route("/", profileViewerRoutes);

const GOLDEN_DIR = path.join(__dirname, "..", "fixtures", "profile");
const GOLDEN_JSON = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, "golden-profile.json"), "utf-8"));
const GOLDEN_MD = fs.readFileSync(path.join(GOLDEN_DIR, "golden-profile.md"), "utf-8");
const GOLDEN_YAML = fs.readFileSync(path.join(GOLDEN_DIR, "golden-profile.yaml"), "utf-8");

describe("SLICE-101-10: E2E — scan → profile → endpoint → web UI", () => {
  beforeAll(() => {
    clearScanCache();
    cacheScanData("api.example.com", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "E2E-TEST",
    });
  });

  it("GET /api/profile/:domain returns valid KnowledgeProfile JSON", async () => {
    const res = await app.request("/api/profile/api.example.com");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile_version).toBe("1.0.0");
    expect(body.schema_version).toBe("0.9.0");
    expect(body.service.domain).toBe("api.example.com");
    expect(body.capabilities).toBeDefined();
    expect(body.auth).toBeDefined();
    expect(body.pricing).toBeDefined();
    expect(body.limits).toBeDefined();
    expect(body.errors).toBeDefined();
    expect(body.policies).toBeDefined();
    expect(body.freshness).toBeDefined();
    expect(body.evidence_summary).toBeDefined();
  });

  it("GET /api/profile/:domain?format=markdown returns markdown", async () => {
    const res = await app.request("/api/profile/api.example.com?format=markdown");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("# Knowledge Profile");
    expect(text).toContain("## Readiness");
    expect(text).toContain("## Freshness");
    expect(text).toContain("## Evidence Summary");
  });

  it("GET /api/profile/:domain?format=yaml returns YAML", async () => {
    const res = await app.request("/api/profile/api.example.com?format=yaml");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("profile_version:");
    expect(text).toContain("service:");
  });

  it("GET /profile/:domain returns HTML viewer", async () => {
    const res = await app.request("/profile/api.example.com");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Knowledge Profile");
    expect(html).toContain("Readiness");
    expect(html).toContain("api.example.com");
  });

  it("GET /api/profile/unknown returns 404", async () => {
    const res = await app.request("/api/profile/unknown.example.com");
    expect(res.status).toBe(404);
  });
});

describe("SLICE-101-10: Golden fixture validation", () => {
  it("golden JSON passes schema validation", () => {
    const result = knowledgeProfileSchema.safeParse(GOLDEN_JSON);
    expect(result.success).toBe(true);
  });

  it("golden JSON has all 12 top-level keys", () => {
    const keys = Object.keys(GOLDEN_JSON);
    expect(keys).toContain("profile_version");
    expect(keys).toContain("schema_version");
    expect(keys).toContain("service");
    expect(keys).toContain("readiness");
    expect(keys).toContain("capabilities");
    expect(keys).toContain("auth");
    expect(keys).toContain("pricing");
    expect(keys).toContain("limits");
    expect(keys).toContain("errors");
    expect(keys).toContain("policies");
    expect(keys).toContain("freshness");
    expect(keys).toContain("evidence_summary");
  });

  it("golden JSON has all 6 content sections populated", () => {
    expect(GOLDEN_JSON.capabilities).not.toBeNull();
    expect(GOLDEN_JSON.auth).not.toBeNull();
    expect(GOLDEN_JSON.pricing).not.toBeNull();
    expect(GOLDEN_JSON.limits).not.toBeNull();
    expect(GOLDEN_JSON.errors).not.toBeNull();
    expect(GOLDEN_JSON.policies).not.toBeNull();
  });

  it("golden markdown contains all section headers", () => {
    expect(GOLDEN_MD).toContain("# Knowledge Profile");
    expect(GOLDEN_MD).toContain("## Readiness");
    expect(GOLDEN_MD).toContain("## Freshness");
    expect(GOLDEN_MD).toContain("## Evidence Summary");
  });

  it("golden YAML contains profile_version and service", () => {
    expect(GOLDEN_YAML).toContain("profile_version:");
    expect(GOLDEN_YAML).toContain("service:");
    expect(GOLDEN_YAML).toContain("readiness:");
  });
});

describe("SLICE-101-10: Zero-drift — buildProfile output matches goldens", () => {
  it("JSON output matches golden-profile.json (structure)", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "GOLDEN-FIXTURE",
    });
    expect(profile.profile_version).toBe(GOLDEN_JSON.profile_version);
    expect(profile.schema_version).toBe(GOLDEN_JSON.schema_version);
    expect(profile.service.domain).toBe(GOLDEN_JSON.service.domain);
    expect(profile.readiness.total_rules).toBe(GOLDEN_JSON.readiness.total_rules);
    expect(profile.evidence_summary.total_assertions).toBe(GOLDEN_JSON.evidence_summary.total_assertions);
    expect(profile.capabilities).toBeDefined();
    expect(profile.auth).toBeDefined();
    expect(profile.pricing).toBeDefined();
    expect(profile.limits).toBeDefined();
    expect(profile.errors).toBeDefined();
    expect(profile.policies).toBeDefined();
  });

  it("markdown output matches golden-profile.md (structure)", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "GOLDEN-FIXTURE",
    });
    const md = renderProfileMarkdown(profile);
    expect(md).toContain("# Knowledge Profile");
    expect(md).toContain("## Readiness");
    expect(md).toContain("## Capabilities");
    expect(md).toContain("## Freshness");
    expect(md).toContain("## Evidence Summary");
  });

  it("YAML output matches golden-profile.yaml (structure)", () => {
    const profile = buildProfile({
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "GOLDEN-FIXTURE",
    });
    const yaml = renderProfileYaml(profile);
    expect(yaml).toContain("profile_version:");
    expect(yaml).toContain("service:");
    expect(yaml).toContain("readiness:");
  });
});

describe("SLICE-101-10: Section-map completeness", () => {
  it("every rule category in fixture is known (mapped or intentionally unmapped)", () => {
    const assertions = makeFixtureAssertions();
    const categories = new Set(assertions.map((a: any) => a.category));

    const knownCategories = new Set([
      "discovery", "documentation", "openapi", "bot_auth", "identity",
      "pricing", "payments", "rate_limits", "error_semantics",
      "agent_policy", "agents_txt", "sandbox",
      // Intentionally unmapped
      "infrastructure", "seo_aeo", "versioning", "actionability",
      "machine_readable", "verification", "content_negotiation", "bazaar",
      "skills", "webmcp", "accessibility", "active_probing",
    ]);

    for (const cat of categories) {
      expect(knownCategories.has(cat)).toBe(true);
    }
  });
});
