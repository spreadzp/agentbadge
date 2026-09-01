import { describe, it, expect } from "vitest";
import {
  sourceClassEnum,
  SOURCE_CLASS_RANK,
  SOURCE_CLASS_LABELS,
  classifyEvidence,
  strongestSource,
  sortByRankDescending,
} from "../../../src/agent-readiness/rule-engine/source-hierarchy";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";
import type { SourceClass } from "../../../src/agent-readiness/rule-engine/source-hierarchy";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function httpEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    type: "http",
    url: "https://example.com/api",
    status: 200,
    headers: {},
    content_hash: "abc123",
    content_type: "application/json",
    resolved_ip: "1.2.3.4",
    ...overrides,
  } as Evidence;
}

function openApiEvidence(): Evidence {
  return { type: "openapi", url: "https://example.com/openapi.json", paths: ["/api"], methods: ["GET"] };
}

function jsonSchemaEvidence(): Evidence {
  return { type: "json_schema", url: "https://example.com/schema.json", schema_keys: ["type"], valid: true };
}

function htmlEvidence(): Evidence {
  return { type: "html", url: "https://example.com/page", title: "Page", content_hash: "hash", content_type: "text/html" };
}

function robotsEvidence(): Evidence {
  return { type: "robots", url: "https://example.com/robots.txt", status: 200, allows_all: true, disallowed_paths: [] };
}

function sitemapEvidence(): Evidence {
  return { type: "sitemap", url: "https://example.com/sitemap.xml", status: 200, url_count: 5, urls: [] };
}

function githubEvidence(): Evidence {
  return { type: "github", repo: "org/repo", path: "/README.md", content_hash: "hash", last_commit: "abc123" };
}

function manualConfirmationEvidence(): Evidence {
  return { type: "manual_confirmation", confirmed_by: "user", confirmed_at: "2026-01-01T00:00:00Z", note: "confirmed" };
}

function crossEvidence(sources: Evidence[], conflictReason = "mismatch"): Evidence {
  return { type: "cross", sources, match_keys: ["key"], conflict_reason: conflictReason };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("SLICE-94-3: Source Hierarchy Module", () => {
  // ─── Classification Table ───────────────────────────────────────────────────

  describe("classifyEvidence — all 9 evidence types", () => {
    it("openapi → machine_readable_spec", () => {
      expect(classifyEvidence(openApiEvidence())).toBe("machine_readable_spec");
    });

    it("json_schema → machine_readable_spec", () => {
      expect(classifyEvidence(jsonSchemaEvidence())).toBe("machine_readable_spec");
    });

    it("robots → machine_readable_guide", () => {
      expect(classifyEvidence(robotsEvidence())).toBe("machine_readable_guide");
    });

    it("sitemap → machine_readable_guide", () => {
      expect(classifyEvidence(sitemapEvidence())).toBe("machine_readable_guide");
    });

    it("github → official_docs", () => {
      expect(classifyEvidence(githubEvidence())).toBe("official_docs");
    });

    it("manual_confirmation → official_docs", () => {
      expect(classifyEvidence(manualConfirmationEvidence())).toBe("official_docs");
    });

    it("html → website_content", () => {
      expect(classifyEvidence(htmlEvidence())).toBe("website_content");
    });

    it("http without checkType → website_content", () => {
      expect(classifyEvidence(httpEvidence())).toBe("website_content");
    });

    it("http + http_fetch → website_content", () => {
      expect(classifyEvidence(httpEvidence(), "http_fetch")).toBe("website_content");
    });

    it("http + http_probe → runtime", () => {
      expect(classifyEvidence(httpEvidence(), "http_probe")).toBe("runtime");
    });

    it("http + content_parse → runtime", () => {
      expect(classifyEvidence(httpEvidence(), "content_parse")).toBe("runtime");
    });

    it("http + header_check → runtime", () => {
      expect(classifyEvidence(httpEvidence(), "header_check")).toBe("runtime");
    });
  });

  // ─── Cross Evidence Recursion ───────────────────────────────────────────────

  describe("cross evidence — recursive classification", () => {
    it("inherits strongest member class (openapi > html)", () => {
      const cross = crossEvidence([htmlEvidence(), openApiEvidence()]);
      expect(classifyEvidence(cross)).toBe("machine_readable_spec");
    });

    it("inherits strongest member class (robots > html)", () => {
      const cross = crossEvidence([htmlEvidence(), robotsEvidence()]);
      expect(classifyEvidence(cross)).toBe("machine_readable_guide");
    });

    it("nested cross — resolves recursively", () => {
      const inner = crossEvidence([openApiEvidence(), htmlEvidence()]);
      const outer = crossEvidence([htmlEvidence(), inner]);
      expect(classifyEvidence(outer)).toBe("machine_readable_spec");
    });

    it("empty cross sources → website_content fallback", () => {
      const cross = crossEvidence([]);
      expect(classifyEvidence(cross)).toBe("website_content");
    });
  });

  // ─── strongestSource ────────────────────────────────────────────────────────

  describe("strongestSource", () => {
    it("returns highest-rank member (openapi rank 5 in mixed set)", () => {
      const evidence = [htmlEvidence(), openApiEvidence(), robotsEvidence()];
      const result = strongestSource(evidence);
      expect(result).not.toBeNull();
      expect(result!.evidence.type).toBe("openapi");
      expect(result!.sourceClass).toBe("machine_readable_spec");
    });

    it("returns null for empty input", () => {
      expect(strongestSource([])).toBeNull();
    });

    it("ties broken by insertion order (first wins)", () => {
      const first = htmlEvidence();
      const second = htmlEvidence();
      const result = strongestSource([first, second]);
      expect(result!.evidence).toBe(first);
    });

    it("cross evidence ranked by its strongest member", () => {
      const cross = crossEvidence([openApiEvidence(), htmlEvidence()]);
      const result = strongestSource([htmlEvidence(), cross]);
      expect(result!.evidence.type).toBe("cross");
      expect(result!.sourceClass).toBe("machine_readable_spec");
    });
  });

  // ─── sortByRankDescending ───────────────────────────────────────────────────

  describe("sortByRankDescending", () => {
    it("sorts higher rank first", () => {
      const evidence = [htmlEvidence(), openApiEvidence(), robotsEvidence()];
      const sorted = sortByRankDescending(evidence);
      expect(sorted[0].type).toBe("openapi");
      expect(sorted[1].type).toBe("robots");
      expect(sorted[2].type).toBe("html");
    });

    it("stable sort — equal ranks keep insertion order", () => {
      const first = htmlEvidence();
      const second = htmlEvidence();
      const sorted = sortByRankDescending([first, second]);
      expect(sorted[0]).toBe(first);
      expect(sorted[1]).toBe(second);
    });

    it("empty input → empty output", () => {
      expect(sortByRankDescending([])).toEqual([]);
    });
  });

  // ─── Completeness Guards ────────────────────────────────────────────────────

  describe("completeness", () => {
    it("SOURCE_CLASS_RANK has all 6 classes with ranks 1–6", () => {
      const classes = Object.keys(SOURCE_CLASS_RANK) as SourceClass[];
      expect(classes).toHaveLength(6);
      const ranks = Object.values(SOURCE_CLASS_RANK);
      expect(ranks.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("SOURCE_CLASS_LABELS has all 6 classes labeled", () => {
      const labels = Object.keys(SOURCE_CLASS_LABELS) as SourceClass[];
      expect(labels).toHaveLength(6);
      for (const cls of labels) {
        expect(SOURCE_CLASS_LABELS[cls]).toBeTruthy();
        expect(SOURCE_CLASS_LABELS[cls].length).toBeGreaterThan(0);
      }
    });

    it("sourceClassEnum accepts all 6 classes", () => {
      const expected = [
        "runtime",
        "machine_readable_spec",
        "machine_readable_guide",
        "official_docs",
        "website_content",
        "ai_inference",
      ];
      for (const cls of expected) {
        expect(sourceClassEnum.safeParse(cls).success).toBe(true);
      }
    });

    it("sourceClassEnum rejects garbage", () => {
      expect(sourceClassEnum.safeParse("garbage").success).toBe(false);
    });

    it("ranks are strictly ordered: runtime > spec > guide > docs > content > ai_inference", () => {
      expect(SOURCE_CLASS_RANK.runtime).toBeGreaterThan(SOURCE_CLASS_RANK.machine_readable_spec);
      expect(SOURCE_CLASS_RANK.machine_readable_spec).toBeGreaterThan(SOURCE_CLASS_RANK.machine_readable_guide);
      expect(SOURCE_CLASS_RANK.machine_readable_guide).toBeGreaterThan(SOURCE_CLASS_RANK.official_docs);
      expect(SOURCE_CLASS_RANK.official_docs).toBeGreaterThan(SOURCE_CLASS_RANK.website_content);
      expect(SOURCE_CLASS_RANK.website_content).toBeGreaterThan(SOURCE_CLASS_RANK.ai_inference);
    });
  });
});
