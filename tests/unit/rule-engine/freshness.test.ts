import { describe, it, expect } from "vitest";
import {
  DEFAULT_FRESHNESS_THRESHOLDS,
  checkFreshness,
  withFreshness,
} from "../../../src/agent-readiness/rule-engine/freshness";
import type { Evidence } from "../../../src/agent-readiness/rule-engine/evidence.types";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2025-06-15T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function makeEvidence(type: Evidence["type"], overrides: Record<string, unknown> = {}): Evidence {
  const base: Record<string, unknown> = { type };
  if (type === "http") {
    base.url = "https://example.com";
    base.status = 200;
    base.headers = {};
    base.content_hash = "abc";
    base.content_type = "text/html";
    base.resolved_ip = null;
  } else if (type === "openapi") {
    base.url = "https://example.com/openapi.json";
    base.paths = [];
    base.methods = [];
  } else if (type === "cross") {
    base.sources = [];
    base.match_keys = [];
    base.conflict_reason = "";
  }
  return { ...base, ...overrides } as unknown as Evidence;
}

function makeAssertion(overrides: Record<string, unknown> = {}): Assertion {
  return {
    rule_id: "AB-TEST",
    rule_version: "1.0.0",
    status: "VERIFIED",
    evidence: [],
    confidence: 0.9,
    timestamp: "2025-06-15T12:00:00Z",
    source_url: null,
    reason: "test",
    category: "discovery",
    name: "Test Rule",
    claim: "Test claim",
    verified_at: daysAgo(10),
    review_level: "automatic",
    ...overrides,
  } as Assertion;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("SLICE-94-6: Freshness Engine", () => {

  // ─── Age math ──────────────────────────────────────────────────────────────

  describe("checkFreshness — age math", () => {
    it("verifiedAt 10 days ago → age_days: 10", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(10), evidence: [makeEvidence("openapi")] },
        { now: NOW },
      );
      expect(result.age_days).toBe(10);
    });

    it("future timestamp clamps to 0", () => {
      const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
      const result = checkFreshness(
        { verifiedAt: future, evidence: [makeEvidence("openapi")] },
        { now: NOW },
      );
      expect(result.age_days).toBe(0);
    });

    it("verifiedAt exactly now → age_days: 0", () => {
      const result = checkFreshness(
        { verifiedAt: NOW.toISOString(), evidence: [makeEvidence("openapi")] },
        { now: NOW },
      );
      expect(result.age_days).toBe(0);
    });
  });

  // ─── Thresholds — website_content ───────────────────────────────────────────

  describe("checkFreshness — website_content thresholds", () => {
    it("15 days old → stale (14d threshold)", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(15), evidence: [makeEvidence("html")] },
        { now: NOW },
      );
      expect(result.stale).toBe(true);
    });

    it("14 days old → NOT stale (strictly greater)", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(14), evidence: [makeEvidence("html")] },
        { now: NOW },
      );
      expect(result.stale).toBe(false);
    });
  });

  // ─── Per-class thresholds ───────────────────────────────────────────────────

  describe("checkFreshness — per-class", () => {
    it("openapi (machine_readable_spec) 31 days → stale (30d)", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(31), evidence: [makeEvidence("openapi")] },
        { now: NOW },
      );
      expect(result.stale).toBe(true);
    });

    it("openapi (machine_readable_spec) 30 days → NOT stale", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(30), evidence: [makeEvidence("openapi")] },
        { now: NOW },
      );
      expect(result.stale).toBe(false);
    });

    it("github (official_docs) 61 days → stale (60d)", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(61), evidence: [makeEvidence("github")] },
        { now: NOW },
      );
      expect(result.stale).toBe(true);
    });

    it("github (official_docs) 60 days → NOT stale", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(60), evidence: [makeEvidence("github")] },
        { now: NOW },
      );
      expect(result.stale).toBe(false);
    });

    it("http with http_probe check (runtime) 8 days → stale (7d)", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(8), evidence: [makeEvidence("http")], checkType: "http_probe" },
        { now: NOW },
      );
      expect(result.stale).toBe(true);
    });

    it("http with http_probe check (runtime) 7 days → NOT stale", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(7), evidence: [makeEvidence("http")], checkType: "http_probe" },
        { now: NOW },
      );
      expect(result.stale).toBe(false);
    });
  });

  // ─── GAP assertion (no evidence) ────────────────────────────────────────────

  describe("checkFreshness — GAP (no evidence)", () => {
    it("no evidence → stale: false, age_days still computed", () => {
      const result = checkFreshness(
        { verifiedAt: daysAgo(100), evidence: [] },
        { now: NOW },
      );
      expect(result.stale).toBe(false);
      expect(result.age_days).toBe(100);
    });
  });

  // ─── Override thresholds ────────────────────────────────────────────────────

  describe("checkFreshness — custom thresholds override", () => {
    it("custom threshold changes verdict", () => {
      // Default website_content threshold is 14; override to 5
      const result = checkFreshness(
        { verifiedAt: daysAgo(10), evidence: [makeEvidence("html")] },
        {
          now: NOW,
          thresholds: { ...DEFAULT_FRESHNESS_THRESHOLDS, website_content: 5 },
        },
      );
      expect(result.stale).toBe(true);
    });

    it("custom threshold can make stale item fresh", () => {
      // Default website_content threshold is 14; override to 100
      const result = checkFreshness(
        { verifiedAt: daysAgo(20), evidence: [makeEvidence("html")] },
        {
          now: NOW,
          thresholds: { ...DEFAULT_FRESHNESS_THRESHOLDS, website_content: 100 },
        },
      );
      expect(result.stale).toBe(false);
    });
  });

  // ─── Cross evidence — strongest member drives threshold ─────────────────────

  describe("checkFreshness — cross evidence uses strongest member class", () => {
    it("cross with openapi + html → machine_readable_spec threshold (30d)", () => {
      const cross = makeEvidence("cross", {
        sources: [
          makeEvidence("html"),
          makeEvidence("openapi"),
        ],
      });
      // 31 days → stale under machine_readable_spec (30d)
      const result = checkFreshness(
        { verifiedAt: daysAgo(31), evidence: [cross] },
        { now: NOW },
      );
      expect(result.stale).toBe(true);
    });

    it("cross with openapi + html → 30 days NOT stale", () => {
      const cross = makeEvidence("cross", {
        sources: [
          makeEvidence("html"),
          makeEvidence("openapi"),
        ],
      });
      const result = checkFreshness(
        { verifiedAt: daysAgo(30), evidence: [cross] },
        { now: NOW },
      );
      expect(result.stale).toBe(false);
    });
  });

  // ─── withFreshness enrichment helper ────────────────────────────────────────

  describe("withFreshness — assertion enrichment", () => {
    it("returns assertion with age_days and stale added", () => {
      const assertion = makeAssertion({
        verified_at: daysAgo(20),
        evidence: [makeEvidence("html")],
      });
      const enriched = withFreshness(assertion, { now: NOW });
      expect(enriched.age_days).toBe(20);
      expect(enriched.stale).toBe(true);
      // Original fields preserved
      expect(enriched.rule_id).toBe("AB-TEST");
      expect(enriched.status).toBe("VERIFIED");
    });

    it("GAP assertion → stale: false", () => {
      const assertion = makeAssertion({
        status: "GAP",
        evidence: [],
        verified_at: daysAgo(500),
      });
      const enriched = withFreshness(assertion, { now: NOW });
      expect(enriched.stale).toBe(false);
      expect(enriched.age_days).toBe(500);
    });
  });

  // ─── DEFAULT_FRESHNESS_THRESHOLDS ───────────────────────────────────────────

  describe("DEFAULT_FRESHNESS_THRESHOLDS", () => {
    it("has all 6 source classes", () => {
      expect(Object.keys(DEFAULT_FRESHNESS_THRESHOLDS).sort()).toEqual(
        ["ai_inference", "machine_readable_guide", "machine_readable_spec", "official_docs", "runtime", "website_content"],
      );
    });

    it("runtime = 7", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.runtime).toBe(7);
    });

    it("machine_readable_spec = 30", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.machine_readable_spec).toBe(30);
    });

    it("machine_readable_guide = 30", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.machine_readable_guide).toBe(30);
    });

    it("official_docs = 60", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.official_docs).toBe(60);
    });

    it("website_content = 14", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.website_content).toBe(14);
    });

    it("ai_inference = 1", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.ai_inference).toBe(1);
    });
  });
});
