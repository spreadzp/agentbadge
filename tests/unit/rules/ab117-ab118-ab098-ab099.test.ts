import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB117 } from "../../../src/agent-readiness/rules/AB117";
import { AB118 } from "../../../src/agent-readiness/rules/AB118";
import { AB098 } from "../../../src/agent-readiness/rules/AB098";
import { AB099 } from "../../../src/agent-readiness/rules/AB099";
import { RULE_CHECKERS } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function makeState(snaps: Record<string, ResponseSnapshot | null>): SourceState {
  return { domain: "example.com", scannedAt: new Date().toISOString(), snapshots: snaps };
}

function makeSnap(body: string, contentType = "application/json"): ResponseSnapshot {
  return {
    url: "https://example.com/",
    status: 200,
    bodyHash: "abc",
    bodySize: body.length,
    contentType,
    resolvedIp: null,
    fetchedAt: new Date().toISOString(),
    fetchTimeMs: 0,
    redirectChain: [],
    body,
  };
}

describe("SLICE-75-5: Accessibility Rules AB-117, AB-118, AB-098, AB-099", () => {
  // ─── AB-117: Image alt text coverage ───────────────────────────────────────────
  describe("AB-117: Image alt text coverage", () => {
    it("has correct metadata", () => {
      expect(AB117.rule_id).toBe("AB-117");
      expect(AB117.name).toBe("Image alt text coverage");
      expect(AB117.category).toBe("accessibility");
      expect(AB117.severity).toBe("medium");
      expect(AB117.counted_in_score).toBe(true);
      expect(AB117.check.type).toBe("content_parse");
      expect(AB117.check.sources).toContain("accessibility");
      expect(AB117.check.match_keys).toContain("imagesWithoutAlt");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB117);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-117");
      expect(found).toBeDefined();
      expect(found).toBe(AB117);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-117"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-117");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Image alt text coverage");
    });

    it("returns evidence when accessibility snapshot exists", () => {
      const body = JSON.stringify({
        source: "accessibility",
        data: { totalImages: 5, imagesWithAlt: 3, imagesWithoutAlt: 2, imagesWithLazyLoading: 1, hasAriaLabels: true, hasSkipLink: false },
      });
      const state = makeState({ accessibility: makeSnap(body) });
      const evidence = RULE_CHECKERS["AB-117"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-117"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-118: Lazy loading on below-fold images ─────────────────────────────────
  describe("AB-118: Lazy loading on below-fold images", () => {
    it("has correct metadata", () => {
      expect(AB118.rule_id).toBe("AB-118");
      expect(AB118.name).toBe("Lazy loading on below-fold images");
      expect(AB118.category).toBe("accessibility");
      expect(AB118.severity).toBe("low");
      expect(AB118.counted_in_score).toBe(true);
      expect(AB118.check.type).toBe("content_parse");
      expect(AB118.check.sources).toContain("accessibility");
      expect(AB118.check.match_keys).toContain("imagesWithLazyLoading");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB118);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-118");
      expect(found).toBeDefined();
      expect(found).toBe(AB118);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-118"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-118");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Lazy loading on below-fold images");
    });

    it("returns evidence when accessibility snapshot exists", () => {
      const body = JSON.stringify({
        source: "accessibility",
        data: { totalImages: 5, imagesWithAlt: 5, imagesWithoutAlt: 0, imagesWithLazyLoading: 3, hasAriaLabels: true, hasSkipLink: true },
      });
      const state = makeState({ accessibility: makeSnap(body) });
      const evidence = RULE_CHECKERS["AB-118"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-118"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-098: Content-Security-Policy header ────────────────────────────────────
  describe("AB-098: Content-Security-Policy header", () => {
    it("has correct metadata", () => {
      expect(AB098.rule_id).toBe("AB-098");
      expect(AB098.name).toBe("Content-Security-Policy header");
      expect(AB098.category).toBe("infrastructure");
      expect(AB098.severity).toBe("high");
      expect(AB098.counted_in_score).toBe(true);
      expect(AB098.check.type).toBe("header_check");
      expect(AB098.check.match_keys).toContain("content-security-policy");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB098);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-098");
      expect(found).toBeDefined();
      expect(found).toBe(AB098);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-098"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-098");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Content-Security-Policy header");
    });

    it("returns evidence when infrastructure snapshot exists", () => {
      const body = JSON.stringify({
        source: "infrastructure",
        data: { httpsRedirect: true, cacheHeaders: true, structuredErrors: false, rateLimitHeaders: false, contentSecurityPolicy: true, referrerPolicy: false },
      });
      const state = makeState({ infrastructure: makeSnap(body) });
      const evidence = RULE_CHECKERS["AB-098"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-098"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-099: Referrer-Policy header ────────────────────────────────────────────
  describe("AB-099: Referrer-Policy header", () => {
    it("has correct metadata", () => {
      expect(AB099.rule_id).toBe("AB-099");
      expect(AB099.name).toBe("Referrer-Policy header");
      expect(AB099.category).toBe("infrastructure");
      expect(AB099.severity).toBe("low");
      expect(AB099.counted_in_score).toBe(true);
      expect(AB099.check.type).toBe("header_check");
      expect(AB099.check.match_keys).toContain("referrer-policy");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB099);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-099");
      expect(found).toBeDefined();
      expect(found).toBe(AB099);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-099"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-099");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Referrer-Policy header");
    });

    it("returns evidence when infrastructure snapshot exists", () => {
      const body = JSON.stringify({
        source: "infrastructure",
        data: { httpsRedirect: true, cacheHeaders: true, structuredErrors: false, rateLimitHeaders: false, contentSecurityPolicy: true, referrerPolicy: true },
      });
      const state = makeState({ infrastructure: makeSnap(body) });
      const evidence = RULE_CHECKERS["AB-099"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-099"](state);
      expect(evidence).toHaveLength(0);
    });
  });
});
