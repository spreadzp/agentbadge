import { describe, it, expect } from "vitest";
import {
  type Evidence,
  isHttpEvidence,
  isOpenApiEvidence,
  isJsonSchemaEvidence,
  isHtmlEvidence,
  isRobotsEvidence,
  isSitemapEvidence,
  isGithubEvidence,
  isManualConfirmationEvidence,
  isCrossEvidence,
  evidenceSummary,
} from "../../../src/agent-readiness/rule-engine/evidence.types";

// ─── HTTP Evidence ────────────────────────────────────────────────────────────

describe("HttpEvidence", () => {
  const examples: Evidence[] = [
    { type: "http", url: "https://example.com/robots.txt", status: 200, headers: { "content-type": "text/plain" }, content_hash: "abc123def456", content_type: "text/plain", resolved_ip: "93.184.216.34" },
    { type: "http", url: "https://example.com/404", status: 404, headers: {}, content_hash: "deadbeef", content_type: null, resolved_ip: "93.184.216.34" },
    { type: "http", url: "http://localhost:8080/api", status: 200, headers: { "x-custom": "val" }, content_hash: "0000ffff", content_type: "application/json", resolved_ip: null },
  ];

  it.each(examples)("isHttpEvidence returns true for %#", (e) => {
    expect(isHttpEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("HTTP");
    expect(s).toContain(String((e as any).status));
    expect(s).toContain((e as any).url);
  });

  it("isHttpEvidence returns false for non-http", () => {
    expect(isHttpEvidence({ type: "openapi", url: "", paths: [], methods: [] })).toBe(false);
  });
});

// ─── OpenApi Evidence ─────────────────────────────────────────────────────────

describe("OpenApiEvidence", () => {
  const examples: Evidence[] = [
    { type: "openapi", url: "https://example.com/openapi.json", paths: ["/api", "/api/agents"], methods: ["GET", "POST"] },
    { type: "openapi", url: "https://example.com/v3/api-docs", paths: ["/health"], methods: ["GET"] },
    { type: "openapi", url: "https://example.com/swagger.json", paths: ["/api", "/api/health", "/api/agents"], methods: ["GET", "POST", "DELETE"] },
  ];

  it.each(examples)("isOpenApiEvidence returns true for %#", (e) => {
    expect(isOpenApiEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("OpenAPI");
    expect(s).toContain("paths");
  });

  it("isOpenApiEvidence returns false for non-openapi", () => {
    expect(isOpenApiEvidence({ type: "http", url: "", status: 0, headers: {}, content_hash: "", content_type: null, resolved_ip: null })).toBe(false);
  });
});

// ─── JsonSchema Evidence ──────────────────────────────────────────────────────

describe("JsonSchemaEvidence", () => {
  const examples: Evidence[] = [
    { type: "json_schema", url: "https://example.com/schema.json", schema_keys: ["type", "properties"], valid: true },
    { type: "json_schema", url: "https://example.com/bad.json", schema_keys: [], valid: false },
    { type: "json_schema", url: "https://example.com/agent.json", schema_keys: ["name", "version", "capabilities"], valid: true },
  ];

  it.each(examples)("isJsonSchemaEvidence returns true for %#", (e) => {
    expect(isJsonSchemaEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("JSON Schema");
    expect(s).toContain("valid=");
  });

  it("isJsonSchemaEvidence returns false for non-json_schema", () => {
    expect(isJsonSchemaEvidence({ type: "http", url: "", status: 0, headers: {}, content_hash: "", content_type: null, resolved_ip: null })).toBe(false);
  });
});

// ─── HTML Evidence ────────────────────────────────────────────────────────────

describe("HtmlEvidence", () => {
  const examples: Evidence[] = [
    { type: "html", url: "https://example.com/", title: "Example Domain", content_hash: "aabbccdd", content_type: "text/html" },
    { type: "html", url: "https://example.com/about", title: null, content_hash: "11223344", content_type: "text/html" },
    { type: "html", url: "https://example.com/docs", title: "Documentation", content_hash: "ffeeddcc", content_type: null },
  ];

  it.each(examples)("isHtmlEvidence returns true for %#", (e) => {
    expect(isHtmlEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("HTML");
    expect(s).toContain("title=");
  });

  it("isHtmlEvidence returns false for non-html", () => {
    expect(isHtmlEvidence({ type: "openapi", url: "", paths: [], methods: [] })).toBe(false);
  });
});

// ─── Robots Evidence ──────────────────────────────────────────────────────────

describe("RobotsEvidence", () => {
  const examples: Evidence[] = [
    { type: "robots", url: "https://example.com/robots.txt", status: 200, allows_all: true, disallowed_paths: [] },
    { type: "robots", url: "https://example.com/robots.txt", status: 200, allows_all: false, disallowed_paths: ["/private", "/admin"] },
    { type: "robots", url: "https://example.com/robots.txt", status: 404, allows_all: false, disallowed_paths: [] },
  ];

  it.each(examples)("isRobotsEvidence returns true for %#", (e) => {
    expect(isRobotsEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("robots.txt");
    expect(s).toContain("allows_all=");
  });

  it("isRobotsEvidence returns false for non-robots", () => {
    expect(isRobotsEvidence({ type: "http", url: "", status: 0, headers: {}, content_hash: "", content_type: null, resolved_ip: null })).toBe(false);
  });
});

// ─── Sitemap Evidence ─────────────────────────────────────────────────────────

describe("SitemapEvidence", () => {
  const examples: Evidence[] = [
    { type: "sitemap", url: "https://example.com/sitemap.xml", status: 200, url_count: 3, urls: ["https://example.com/", "https://example.com/api", "https://example.com/docs"] },
    { type: "sitemap", url: "https://example.com/sitemap.xml", status: 200, url_count: 0, urls: [] },
    { type: "sitemap", url: "https://example.com/sitemap.xml", status: 404, url_count: 0, urls: [] },
  ];

  it.each(examples)("isSitemapEvidence returns true for %#", (e) => {
    expect(isSitemapEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("sitemap.xml");
    expect(s).toContain("URLs");
  });

  it("isSitemapEvidence returns false for non-sitemap", () => {
    expect(isSitemapEvidence({ type: "robots", url: "", status: 0, allows_all: false, disallowed_paths: [] })).toBe(false);
  });
});

// ─── GitHub Evidence ──────────────────────────────────────────────────────────

describe("GithubEvidence", () => {
  const examples: Evidence[] = [
    { type: "github", repo: "agentbadge/server", path: "src/index.ts", content_hash: "abc123", last_commit: "abcdef1234567890" },
    { type: "github", repo: "agentbadge/client", path: "README.md", content_hash: "def456", last_commit: "fedcba0987654321" },
    { type: "github", repo: "agentbadge/docs", path: "docs/spec.md", content_hash: "ghi789", last_commit: "aabbcc1122334455" },
  ];

  it.each(examples)("isGithubEvidence returns true for %#", (e) => {
    expect(isGithubEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("GitHub");
    expect(s).toContain("commit=");
  });

  it("isGithubEvidence returns false for non-github", () => {
    expect(isGithubEvidence({ type: "http", url: "", status: 0, headers: {}, content_hash: "", content_type: null, resolved_ip: null })).toBe(false);
  });
});

// ─── Manual Confirmation Evidence ─────────────────────────────────────────────

describe("ManualConfirmationEvidence", () => {
  const examples: Evidence[] = [
    { type: "manual_confirmation", confirmed_by: "alice", confirmed_at: "2026-01-01T00:00:00Z", note: "Verified via browser" },
    { type: "manual_confirmation", confirmed_by: "bob", confirmed_at: "2026-02-01T12:00:00Z", note: "Checked manually" },
    { type: "manual_confirmation", confirmed_by: "admin", confirmed_at: "2026-03-15T08:30:00Z", note: "Confirmed endpoint exists" },
  ];

  it.each(examples)("isManualConfirmationEvidence returns true for %#", (e) => {
    expect(isManualConfirmationEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("Manual confirmation");
    expect(s).toContain("by");
  });

  it("isManualConfirmationEvidence returns false for non-manual", () => {
    expect(isManualConfirmationEvidence({ type: "http", url: "", status: 0, headers: {}, content_hash: "", content_type: null, resolved_ip: null })).toBe(false);
  });
});

// ─── Cross Evidence ───────────────────────────────────────────────────────────

describe("CrossEvidence", () => {
  const examples: Evidence[] = [
    {
      type: "cross",
      sources: [
        { type: "openapi", url: "https://a.com/openapi.json", paths: ["/api"], methods: ["GET"] },
        { type: "robots", url: "https://a.com/robots.txt", status: 200, allows_all: true, disallowed_paths: [] },
      ],
      match_keys: ["paths"],
      conflict_reason: "OpenAPI lists /api but robots.txt disallows it",
    },
    {
      type: "cross",
      sources: [
        { type: "http", url: "https://a.com/guide", status: 200, headers: {}, content_hash: "aaa", content_type: "application/json", resolved_ip: "1.2.3.4" },
        { type: "http", url: "https://a.com/openapi", status: 200, headers: {}, content_hash: "bbb", content_type: "application/json", resolved_ip: "1.2.3.4" },
      ],
      match_keys: ["endpoints"],
      conflict_reason: "Guide lists 2 endpoints, OpenAPI lists 3",
    },
    {
      type: "cross",
      sources: [],
      match_keys: [],
      conflict_reason: "No sources to compare",
    },
  ];

  it.each(examples)("isCrossEvidence returns true for %#", (e) => {
    expect(isCrossEvidence(e)).toBe(true);
  });

  it.each(examples)("evidenceSummary returns readable string for %#", (e) => {
    const s = evidenceSummary(e);
    expect(s).toContain("Cross-evidence");
    expect(s).toContain("conflict:");
  });

  it("isCrossEvidence returns false for non-cross", () => {
    expect(isCrossEvidence({ type: "http", url: "", status: 0, headers: {}, content_hash: "", content_type: null, resolved_ip: null })).toBe(false);
  });
});
