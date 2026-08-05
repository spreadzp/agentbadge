import { describe, it, expect } from "vitest";
import { StatusDeterminator } from "../../../src/agent-readiness/rule-engine/status-determinator";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

const mockRule = (overrides?: Partial<AgentReadinessRule>): AgentReadinessRule => ({
  rule_id: "AB-001",
  version: "1.0.0",
  name: "robots.txt present",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: { type: "http_fetch", target: "/robots.txt" },
  fix: { eligible: true, type: "deterministic", note: "Scaffold default" },
  ...overrides,
});

describe("StatusDeterminator", () => {
  // ─── NOT_APPLICABLE ──────────────────────────────────────────────────────

  it("returns NOT_APPLICABLE when isApplicable=false", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: [{ type: "http", url: "https://example.com/robots.txt", status: 200, headers: {}, content_hash: "abc", content_type: "text/plain", resolved_ip: "1.2.3.4" }],
      isApplicable: false,
    });

    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.reason).toContain("does not apply");
  });

  it("returns NOT_APPLICABLE regardless of evidence when isApplicable=false", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: [{ type: "openapi", url: "https://example.com/openapi.json", paths: ["/api"], methods: ["GET"] }],
      isApplicable: false,
    });

    expect(result.status).toBe("NOT_APPLICABLE");
  });

  // ─── MISSING ─────────────────────────────────────────────────────────────

  it("returns MISSING when evidence is null", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: null,
      isApplicable: true,
    });

    expect(result.status).toBe("MISSING");
    expect(result.reason).toContain("No evidence");
  });

  it("returns MISSING when evidence array is empty", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: [],
      isApplicable: true,
    });

    expect(result.status).toBe("MISSING");
  });

  // ─── VERIFIED ────────────────────────────────────────────────────────────

  it("returns VERIFIED for direct http evidence matching target", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: [{ type: "http", url: "https://example.com/robots.txt", status: 200, headers: {}, content_hash: "abc", content_type: "text/plain", resolved_ip: "1.2.3.4" }],
      isApplicable: true,
    });

    expect(result.status).toBe("VERIFIED");
    expect(result.reason).toContain("Direct evidence");
  });

  it("returns VERIFIED for manual confirmation evidence", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: [{ type: "manual_confirmation", confirmed_by: "admin", confirmed_at: "2026-01-01T00:00:00Z", note: "Checked" }],
      isApplicable: true,
    });

    expect(result.status).toBe("VERIFIED");
  });

  // ─── INFERRED ────────────────────────────────────────────────────────────

  it("returns INFERRED when openapi evidence indirectly supports http_fetch rule", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule({ check: { type: "http_fetch", target: "/api" } }),
      evidence: [{ type: "openapi", url: "https://example.com/openapi.json", paths: ["/api"], methods: ["GET"] }],
      isApplicable: true,
    });

    expect(result.status).toBe("INFERRED");
    expect(result.reason).toContain("Indirect");
  });

  it("returns INFERRED when html evidence indirectly supports http_fetch rule", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule({ check: { type: "http_fetch", target: "/about" } }),
      evidence: [{ type: "html", url: "https://example.com/about", title: "About", content_hash: "abc", content_type: "text/html" }],
      isApplicable: true,
    });

    expect(result.status).toBe("INFERRED");
  });

  // ─── CONFLICT ────────────────────────────────────────────────────────────

  it("returns CONFLICT when cross evidence is present", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: [
        { type: "http", url: "https://example.com/robots.txt", status: 200, headers: {}, content_hash: "abc", content_type: "text/plain", resolved_ip: "1.2.3.4" },
        { type: "cross", sources: [], match_keys: ["paths"], conflict_reason: "OpenAPI lists /api but robots disallows it" },
      ],
      isApplicable: true,
    });

    expect(result.status).toBe("CONFLICT");
    expect(result.reason).toContain("OpenAPI lists");
  });

  it("returns CONFLICT with empty conflict reason when only cross evidence", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule(),
      evidence: [{ type: "cross", sources: [], match_keys: [], conflict_reason: "No sources" }],
      isApplicable: true,
    });

    expect(result.status).toBe("CONFLICT");
    expect(result.reason).toBe("No sources");
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────

  it("returns MISSING when evidence exists but doesn't match rule target", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule({ check: { type: "http_fetch", target: "/nonexistent" } }),
      evidence: [{ type: "robots", url: "https://example.com/robots.txt", status: 200, allows_all: true, disallowed_paths: [] }],
      isApplicable: true,
    });

    expect(result.status).toBe("MISSING");
  });

  it("returns VERIFIED for robots evidence matching robots target", () => {
    const result = StatusDeterminator.determine({
      rule: mockRule({ check: { type: "http_fetch", target: "/robots.txt" } }),
      evidence: [{ type: "robots", url: "https://example.com/robots.txt", status: 200, allows_all: true, disallowed_paths: [] }],
      isApplicable: true,
    });

    expect(result.status).toBe("VERIFIED");
  });
});
