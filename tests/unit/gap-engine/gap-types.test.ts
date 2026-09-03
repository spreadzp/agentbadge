import { describe, it, expect } from "vitest";
import {
  gapTypeEnum,
  gapPriorityEnum,
  fixHintEnum,
  categoryEnum,
  type GapType as _GapType,
  type GapPriority as _GapPriority,
  type FixHint as _FixHint,
} from "../../src/agent-readiness/shared.schema";
import {
  type Gap,
  DEFAULT_GAP_TYPE_BY_CATEGORY,
  FIX_HINT_BY_GAP_TYPE,
} from "../../src/agent-readiness/gap-engine/gap-types";
import { agentReadinessRuleSchema } from "../../src/agent-readiness/rule.schema";

/**
 * SLICE-96-2: Gap Types in Runtime — Enums, Interface, Category Defaults
 *
 * Tests that:
 * 1. gapTypeEnum has exactly 4 values matching spec v0.5 §8
 * 2. gapPriorityEnum has exactly 4 values matching spec v0.5 §8
 * 3. fixHintEnum has exactly 3 values matching spec v0.5 §8.3
 * 4. Gap interface has all 13 fields from spec §8
 * 5. DEFAULT_GAP_TYPE_BY_CATEGORY covers all 25 categories exactly once
 * 6. FIX_HINT_BY_GAP_TYPE maps all 4 gap types to valid fix hints
 * 7. Rule schema accepts optional gap_type override; invalid value fails
 * 8. Gap interface serialization round-trip preserves fields
 */

describe("SLICE-96-2: Gap Types in Runtime", () => {
  describe("gapTypeEnum", () => {
    it("has exactly 4 values: documentation, semantic, capability, evidence", () => {
      expect(gapTypeEnum.options).toHaveLength(4);
      expect(gapTypeEnum.options).toContain("documentation");
      expect(gapTypeEnum.options).toContain("semantic");
      expect(gapTypeEnum.options).toContain("capability");
      expect(gapTypeEnum.options).toContain("evidence");
    });
  });

  describe("gapPriorityEnum", () => {
    it("has exactly 4 values: CRITICAL, HIGH, MEDIUM, LOW", () => {
      expect(gapPriorityEnum.options).toHaveLength(4);
      expect(gapPriorityEnum.options).toContain("CRITICAL");
      expect(gapPriorityEnum.options).toContain("HIGH");
      expect(gapPriorityEnum.options).toContain("MEDIUM");
      expect(gapPriorityEnum.options).toContain("LOW");
    });
  });

  describe("fixHintEnum", () => {
    it("has exactly 3 values: deterministic, assisted, manual", () => {
      expect(fixHintEnum.options).toHaveLength(3);
      expect(fixHintEnum.options).toContain("deterministic");
      expect(fixHintEnum.options).toContain("assisted");
      expect(fixHintEnum.options).toContain("manual");
    });
  });

  describe("Gap interface", () => {
    it("has all 13 required fields from spec §8", () => {
      const gap: Gap = {
        gap_id: "gap:documentation:discovery",
        type: "documentation",
        title: "Is there a robots.txt file?",
        description: "robots.txt not found at /robots.txt",
        priority: "HIGH",
        priority_reason: "severity=high; impact 0.20; frequency 1; clamp HIGH",
        related_rules: ["AB-001"],
        evidence_refs: ["evidence-1"],
        fix_hint: "deterministic",
        fix_artifacts: ["robots.txt"],
        pillar: "discovery",
        category: "discovery",
        frequency: 1,
      };
      expect(gap.gap_id).toBe("gap:documentation:discovery");
      expect(gap.type).toBe("documentation");
      expect(gap.title).toBeTruthy();
      expect(gap.description).toBeTruthy();
      expect(gap.priority).toBe("HIGH");
      expect(gap.priority_reason).toBeTruthy();
      expect(gap.related_rules).toHaveLength(1);
      expect(gap.evidence_refs).toHaveLength(1);
      expect(gap.fix_hint).toBe("deterministic");
      expect(gap.fix_artifacts).toHaveLength(1);
      expect(gap.pillar).toBe("discovery");
      expect(gap.category).toBe("discovery");
      expect(gap.frequency).toBe(1);
    });

    it("serialization round-trip preserves all fields", () => {
      const gap: Gap = {
        gap_id: "gap:semantic:pricing",
        type: "semantic",
        title: "What does a call cost?",
        description: "Pricing only in prose; no machine-readable pricing found",
        priority: "HIGH",
        priority_reason: "severity=high; impact 0.25 top-quartile (+1); frequency 1; clamp HIGH",
        related_rules: ["AB-150", "AB-010"],
        evidence_refs: ["evidence-1", "evidence-2"],
        fix_hint: "assisted",
        fix_artifacts: ["agent-guide.json", "llms.txt"],
        pillar: "understandability",
        category: "pricing",
        frequency: 2,
      };
      const roundTripped = JSON.parse(JSON.stringify(gap)) as Gap;
      expect(roundTripped).toEqual(gap);
    });
  });

  describe("DEFAULT_GAP_TYPE_BY_CATEGORY", () => {
    it("covers all 25 categories exactly once", () => {
      const categories = categoryEnum.options;
      for (const cat of categories) {
        expect(
          DEFAULT_GAP_TYPE_BY_CATEGORY[cat as keyof typeof DEFAULT_GAP_TYPE_BY_CATEGORY],
          `missing default gap type for category: ${cat}`,
        ).toBeDefined();
      }
      expect(Object.keys(DEFAULT_GAP_TYPE_BY_CATEGORY)).toHaveLength(25);
    });

    it("all values are valid gap types", () => {
      for (const value of Object.values(DEFAULT_GAP_TYPE_BY_CATEGORY)) {
        expect(gapTypeEnum.options).toContain(value);
      }
    });

    it("documentation categories are 'documentation'", () => {
      const docCategories = ["discovery", "documentation", "machine_readable", "agents_txt", "openapi", "seo_aeo", "webmcp", "content_negotiation", "skills"];
      for (const cat of docCategories) {
        expect(DEFAULT_GAP_TYPE_BY_CATEGORY[cat as keyof typeof DEFAULT_GAP_TYPE_BY_CATEGORY]).toBe("documentation");
      }
    });

    it("semantic categories are 'semantic'", () => {
      const semCategories = ["actionability", "accessibility", "verification", "pricing", "rate_limits", "error_semantics", "retry_semantics", "versioning", "agent_policy", "infrastructure"];
      for (const cat of semCategories) {
        expect(DEFAULT_GAP_TYPE_BY_CATEGORY[cat as keyof typeof DEFAULT_GAP_TYPE_BY_CATEGORY]).toBe("semantic");
      }
    });

    it("capability categories are 'capability'", () => {
      const capCategories = ["bot_auth", "identity", "payments", "bazaar", "sandbox", "active_probing"];
      for (const cat of capCategories) {
        expect(DEFAULT_GAP_TYPE_BY_CATEGORY[cat as keyof typeof DEFAULT_GAP_TYPE_BY_CATEGORY]).toBe("capability");
      }
    });
  });

  describe("FIX_HINT_BY_GAP_TYPE", () => {
    it("maps all 4 gap types to valid fix hints", () => {
      expect(Object.keys(FIX_HINT_BY_GAP_TYPE)).toHaveLength(4);
      expect(FIX_HINT_BY_GAP_TYPE.documentation).toBe("deterministic");
      expect(FIX_HINT_BY_GAP_TYPE.semantic).toBe("assisted");
      expect(FIX_HINT_BY_GAP_TYPE.capability).toBe("manual");
      expect(FIX_HINT_BY_GAP_TYPE.evidence).toBe("manual");
    });

    it("all values are valid fix hints", () => {
      for (const value of Object.values(FIX_HINT_BY_GAP_TYPE)) {
        expect(fixHintEnum.options).toContain(value);
      }
    });
  });

  describe("Rule schema gap_type override", () => {
    const validBase = {
      rule_id: "AB-TEST",
      version: "1.0.0",
      name: "Test Rule",
      category: "discovery",
      severity: "medium",
      counted_in_score: true,
      check: { type: "http_fetch" as const },
      fix: { eligible: true, type: "deterministic" as const },
    };

    it("accepts optional gap_type override", () => {
      const rule = agentReadinessRuleSchema.parse({
        ...validBase,
        gap_type: "semantic",
      });
      expect(rule.gap_type).toBe("semantic");
    });

    it("accepts absent gap_type (default applies later)", () => {
      const rule = agentReadinessRuleSchema.parse(validBase);
      expect(rule.gap_type).toBeUndefined();
    });

    it("rejects invalid gap_type value", () => {
      expect(() =>
        agentReadinessRuleSchema.parse({
          ...validBase,
          gap_type: "invalid_type",
        }),
      ).toThrow();
    });
  });
});
