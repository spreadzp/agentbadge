import { describe, it, expect } from "vitest";
import { ConflictDetector } from "../../../src/agent-readiness/rule-engine/conflict-detector";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";

describe("ConflictDetector", () => {
  it("returns null for single evidence (no conflict possible)", () => {
    const evidence: Evidence[] = [
      { type: "http", url: "https://example.com/robots.txt", status: 200, headers: {}, content_hash: "abc", content_type: "text/plain", resolved_ip: "1.2.3.4" },
    ];
    expect(ConflictDetector.detect(evidence)).toBeNull();
  });

  it("returns null for empty evidence array", () => {
    expect(ConflictDetector.detect([])).toBeNull();
  });

  it("returns null when 2 HTTP sources agree on same URL and status", () => {
    const evidence: Evidence[] = [
      { type: "http", url: "https://example.com/api", status: 200, headers: {}, content_hash: "aaa", content_type: "application/json", resolved_ip: "1.2.3.4" },
      { type: "http", url: "https://example.com/api", status: 200, headers: {}, content_hash: "bbb", content_type: "application/json", resolved_ip: "1.2.3.4" },
    ];
    expect(ConflictDetector.detect(evidence)).toBeNull();
  });

  it("returns CrossEvidence when 2 HTTP sources conflict on status for same URL", () => {
    const evidence: Evidence[] = [
      { type: "http", url: "https://example.com/api", status: 200, headers: {}, content_hash: "aaa", content_type: "application/json", resolved_ip: "1.2.3.4" },
      { type: "http", url: "https://example.com/api", status: 404, headers: {}, content_hash: "bbb", content_type: "text/html", resolved_ip: "1.2.3.4" },
    ];
    const result = ConflictDetector.detect(evidence);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("cross");
    expect(result!.conflict_reason).toContain("200");
    expect(result!.conflict_reason).toContain("404");
    expect(result!.match_keys).toContain("url");
    expect(result!.match_keys).toContain("status");
  });

  it("returns CrossEvidence when 2 OpenAPI sources conflict on paths", () => {
    const evidence: Evidence[] = [
      { type: "openapi", url: "https://example.com/openapi.json", paths: ["/api", "/api/agents"], methods: ["GET"] },
      { type: "openapi", url: "https://example.com/openapi.json", paths: ["/api", "/api/health"], methods: ["GET"] },
    ];
    const result = ConflictDetector.detect(evidence);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("cross");
    expect(result!.conflict_reason).toContain("paths");
  });

  it("returns null when 2 OpenAPI sources agree on paths", () => {
    const evidence: Evidence[] = [
      { type: "openapi", url: "https://example.com/openapi.json", paths: ["/api"], methods: ["GET"] },
      { type: "openapi", url: "https://example.com/openapi.json", paths: ["/api"], methods: ["GET"] },
    ];
    expect(ConflictDetector.detect(evidence)).toBeNull();
  });

  it("returns CrossEvidence when 2 robots sources conflict on allows_all", () => {
    const evidence: Evidence[] = [
      { type: "robots", url: "https://example.com/robots.txt", status: 200, allows_all: true, disallowed_paths: [] },
      { type: "robots", url: "https://example.com/robots.txt", status: 200, allows_all: false, disallowed_paths: ["/private"] },
    ];
    const result = ConflictDetector.detect(evidence);

    expect(result).not.toBeNull();
    expect(result!.conflict_reason).toContain("allows_all");
    expect(result!.conflict_reason).toContain("true");
    expect(result!.conflict_reason).toContain("false");
  });

  it("returns CrossEvidence when 2 sitemap sources conflict on url_count", () => {
    const evidence: Evidence[] = [
      { type: "sitemap", url: "https://example.com/sitemap.xml", status: 200, url_count: 5, urls: [] },
      { type: "sitemap", url: "https://example.com/sitemap.xml", status: 200, url_count: 10, urls: [] },
    ];
    const result = ConflictDetector.detect(evidence);

    expect(result).not.toBeNull();
    expect(result!.conflict_reason).toContain("url_count");
    expect(result!.conflict_reason).toContain("5");
    expect(result!.conflict_reason).toContain("10");
  });

  it("returns null when evidence types are different (no comparison possible)", () => {
    const evidence: Evidence[] = [
      { type: "http", url: "https://example.com/api", status: 200, headers: {}, content_hash: "aaa", content_type: "application/json", resolved_ip: "1.2.3.4" },
      { type: "openapi", url: "https://example.com/openapi.json", paths: ["/api"], methods: ["GET"] },
    ];
    expect(ConflictDetector.detect(evidence)).toBeNull();
  });

  it("handles 3 sources with partial conflict (2 agree, 1 differs)", () => {
    const evidence: Evidence[] = [
      { type: "http", url: "https://example.com/api", status: 200, headers: {}, content_hash: "aaa", content_type: "application/json", resolved_ip: "1.2.3.4" },
      { type: "http", url: "https://example.com/api", status: 200, headers: {}, content_hash: "bbb", content_type: "application/json", resolved_ip: "1.2.3.4" },
      { type: "http", url: "https://example.com/api", status: 500, headers: {}, content_hash: "ccc", content_type: "text/html", resolved_ip: "1.2.3.4" },
    ];
    const result = ConflictDetector.detect(evidence);

    expect(result).not.toBeNull();
    expect(result!.conflict_reason).toContain("200");
    expect(result!.conflict_reason).toContain("500");
  });

  it("conflict reason includes which keys disagree", () => {
    const evidence: Evidence[] = [
      { type: "http", url: "https://example.com/test", status: 200, headers: {}, content_hash: "aaa", content_type: "text/plain", resolved_ip: "1.2.3.4" },
      { type: "http", url: "https://example.com/test", status: 403, headers: {}, content_hash: "bbb", content_type: "text/html", resolved_ip: "1.2.3.4" },
    ];
    const result = ConflictDetector.detect(evidence);

    expect(result!.match_keys).toContain("url");
    expect(result!.match_keys).toContain("status");
  });
});
