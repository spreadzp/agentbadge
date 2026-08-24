import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB104 } from "../../../src/agent-readiness/rules/AB104";
import { AB105 } from "../../../src/agent-readiness/rules/AB105";
import { AB106 } from "../../../src/agent-readiness/rules/AB106";
import { AB107 } from "../../../src/agent-readiness/rules/AB107";
import { AB108 } from "../../../src/agent-readiness/rules/AB108";
import { RULE_CHECKERS } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function makeState(snaps: Record<string, ResponseSnapshot | null>): SourceState {
  return { domain: "example.com", scannedAt: new Date().toISOString(), snapshots: snaps };
}

function makeSnap(body: string): ResponseSnapshot {
  return {
    url: "https://example.com/",
    status: 200,
    bodyHash: "abc",
    bodySize: body.length,
    contentType: "application/json",
    resolvedIp: null,
    fetchedAt: new Date().toISOString(),
    fetchTimeMs: 0,
    redirectChain: [],
    body,
  };
}

describe("SLICE-75-2: SEO/AEO Rules AB-104 through AB-108", () => {
  describe("AB-104: Blog article OpenGraph type", () => {
    it("has correct metadata", () => {
      expect(AB104.rule_id).toBe("AB-104");
      expect(AB104.name).toBe("Blog article OpenGraph type");
      expect(AB104.category).toBe("seo_aeo");
      expect(AB104.severity).toBe("medium");
      expect(AB104.counted_in_score).toBe(true);
      expect(AB104.check.type).toBe("content_parse");
      expect(AB104.check.sources).toContain("og_meta");
      expect(AB104.check.match_keys).toContain("ogType");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB104);
      expect(result.success).toBe(true);
    });

    it("checker returns evidence when og_meta has ogType=article", () => {
      const state = makeState({
        og_meta: makeSnap(JSON.stringify({ data: { ogType: "article" } })),
      });
      const checker = RULE_CHECKERS["AB-104"];
      expect(checker).toBeDefined();
      const evidence = checker(state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns empty when no og_meta snapshot", () => {
      const state = makeState({});
      const checker = RULE_CHECKERS["AB-104"];
      const evidence = checker(state);
      expect(evidence).toHaveLength(0);
    });
  });

  describe("AB-105: Article author and date meta tags", () => {
    it("has correct metadata", () => {
      expect(AB105.rule_id).toBe("AB-105");
      expect(AB105.name).toBe("Article author and date meta tags");
      expect(AB105.category).toBe("seo_aeo");
      expect(AB105.severity).toBe("medium");
      expect(AB105.counted_in_score).toBe(true);
      expect(AB105.check.type).toBe("content_parse");
      expect(AB105.check.sources).toContain("og_meta");
      expect(AB105.check.match_keys).toContain("articleAuthor");
      expect(AB105.check.match_keys).toContain("articlePublishedTime");
      expect(AB105.check.match_keys).toContain("articleModifiedTime");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB105);
      expect(result.success).toBe(true);
    });

    it("checker returns evidence when og_meta has articleAuthor", () => {
      const state = makeState({
        og_meta: makeSnap(JSON.stringify({ data: { articleAuthor: "Jane Doe" } })),
      });
      const checker = RULE_CHECKERS["AB-105"];
      expect(checker).toBeDefined();
      const evidence = checker(state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns empty when no og_meta snapshot", () => {
      const state = makeState({});
      const checker = RULE_CHECKERS["AB-105"];
      const evidence = checker(state);
      expect(evidence).toHaveLength(0);
    });
  });

  describe("AB-106: AEO short-answer summary block", () => {
    it("has correct metadata", () => {
      expect(AB106.rule_id).toBe("AB-106");
      expect(AB106.name).toBe("AEO short-answer summary block");
      expect(AB106.category).toBe("seo_aeo");
      expect(AB106.severity).toBe("low");
      expect(AB106.counted_in_score).toBe(true);
      expect(AB106.check.type).toBe("content_parse");
      expect(AB106.check.sources).toContain("aeo_content");
      expect(AB106.check.match_keys).toContain("hasShortAnswer");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB106);
      expect(result.success).toBe(true);
    });

    it("checker returns evidence when aeo_content has short answer", () => {
      const state = makeState({
        aeo_content: makeSnap(JSON.stringify({ data: { hasShortAnswer: true } })),
      });
      const checker = RULE_CHECKERS["AB-106"];
      expect(checker).toBeDefined();
      const evidence = checker(state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns empty when no aeo_content snapshot", () => {
      const state = makeState({});
      const checker = RULE_CHECKERS["AB-106"];
      const evidence = checker(state);
      expect(evidence).toHaveLength(0);
    });
  });

  describe("AB-107: Semantic definition lists in guide content", () => {
    it("has correct metadata", () => {
      expect(AB107.rule_id).toBe("AB-107");
      expect(AB107.name).toBe("Semantic definition lists in guide content");
      expect(AB107.category).toBe("seo_aeo");
      expect(AB107.severity).toBe("low");
      expect(AB107.counted_in_score).toBe(true);
      expect(AB107.check.type).toBe("content_parse");
      expect(AB107.check.sources).toContain("semantic_html");
      expect(AB107.check.match_keys).toContain("hasDefinitionList");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB107);
      expect(result.success).toBe(true);
    });

    it("checker returns evidence when semantic_html has definition list", () => {
      const state = makeState({
        semantic_html: makeSnap(JSON.stringify({ data: { hasDefinitionList: true } })),
      });
      const checker = RULE_CHECKERS["AB-107"];
      expect(checker).toBeDefined();
      const evidence = checker(state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns empty when no semantic_html snapshot", () => {
      const state = makeState({});
      const checker = RULE_CHECKERS["AB-107"];
      const evidence = checker(state);
      expect(evidence).toHaveLength(0);
    });
  });

  describe("AB-108: OG image alt text brand consistency", () => {
    it("has correct metadata", () => {
      expect(AB108.rule_id).toBe("AB-108");
      expect(AB108.name).toBe("OG image alt text brand consistency");
      expect(AB108.category).toBe("seo_aeo");
      expect(AB108.severity).toBe("low");
      expect(AB108.counted_in_score).toBe(true);
      expect(AB108.check.type).toBe("content_parse");
      expect(AB108.check.sources).toContain("og_meta");
      expect(AB108.check.match_keys).toContain("ogImageAlt");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB108);
      expect(result.success).toBe(true);
    });

    it("checker returns evidence when og_meta has ogImageAlt", () => {
      const state = makeState({
        og_meta: makeSnap(JSON.stringify({ data: { ogImageAlt: "AgentBadge Diagram" } })),
      });
      const checker = RULE_CHECKERS["AB-108"];
      expect(checker).toBeDefined();
      const evidence = checker(state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns empty when no og_meta snapshot", () => {
      const state = makeState({});
      const checker = RULE_CHECKERS["AB-108"];
      const evidence = checker(state);
      expect(evidence).toHaveLength(0);
    });
  });

  describe("Ruleset registration", () => {
    it("all 5 rules registered in ruleset", () => {
      const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
      expect(ids).toContain("AB-104");
      expect(ids).toContain("AB-105");
      expect(ids).toContain("AB-106");
      expect(ids).toContain("AB-107");
      expect(ids).toContain("AB-108");
    });

    it("all 5 rules have descriptions", () => {
      const descIds = RULE_DESCRIPTIONS.map((d) => d.rule_id);
      expect(descIds).toContain("AB-104");
      expect(descIds).toContain("AB-105");
      expect(descIds).toContain("AB-106");
      expect(descIds).toContain("AB-107");
      expect(descIds).toContain("AB-108");
    });

    it("all 5 checkers registered in RULE_CHECKERS", () => {
      expect(RULE_CHECKERS["AB-104"]).toBeDefined();
      expect(RULE_CHECKERS["AB-105"]).toBeDefined();
      expect(RULE_CHECKERS["AB-106"]).toBeDefined();
      expect(RULE_CHECKERS["AB-107"]).toBeDefined();
      expect(RULE_CHECKERS["AB-108"]).toBeDefined();
    });

    it("all 5 rules validate against schema", () => {
      for (const rule of [AB104, AB105, AB106, AB107, AB108]) {
        const result = agentReadinessRuleSchema.safeParse(rule);
        expect(result.success, `${rule.rule_id} should validate`).toBe(true);
      }
    });
  });
});
