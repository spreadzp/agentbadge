import { describe, it, expect } from "vitest";
import {
  categoryEnum,
  severityEnum,
  checkTypeEnum,
  pillarEnum,
  statusEnum,
  fixTypeEnum,
} from "../../../src/agent-readiness/shared.schema";

describe("Spec v0.4 — Schema Enums (EPIC-95)", () => {
  describe("categoryEnum — 25 categories (18 legacy + 7 new)", () => {
    const legacyCategories = [
      "discovery",
      "documentation",
      "actionability",
      "machine_readable",
      "verification",
      "content_negotiation",
      "payments",
      "bazaar",
      "openapi",
      "skills",
      "agents_txt",
      "webmcp",
      "identity",
      "bot_auth",
      "infrastructure",
      "seo_aeo",
      "accessibility",
      "active_probing",
    ];

    const newCategories = [
      "pricing",
      "rate_limits",
      "error_semantics",
      "retry_semantics",
      "sandbox",
      "versioning",
      "agent_policy",
    ];

    it("accepts all 18 legacy categories", () => {
      for (const cat of legacyCategories) {
        expect(categoryEnum.safeParse(cat).success).toBe(true);
      }
    });

    it("accepts all 7 new v0.4 categories", () => {
      for (const cat of newCategories) {
        expect(categoryEnum.safeParse(cat).success).toBe(true);
      }
    });

    it("has exactly 25 categories total", () => {
      const options = categoryEnum.options;
      expect(options).toHaveLength(25);
    });

    it("rejects unknown categories", () => {
      expect(categoryEnum.safeParse("unknown_cat").success).toBe(false);
      expect(categoryEnum.safeParse("").success).toBe(false);
    });
  });

  describe("severityEnum — 4 levels (critical added in v0.4)", () => {
    it("accepts critical severity (new in v0.4)", () => {
      expect(severityEnum.safeParse("critical").success).toBe(true);
    });

    it("accepts all legacy severities", () => {
      expect(severityEnum.safeParse("high").success).toBe(true);
      expect(severityEnum.safeParse("medium").success).toBe(true);
      expect(severityEnum.safeParse("low").success).toBe(true);
    });

    it("has exactly 4 severity levels", () => {
      expect(severityEnum.options).toHaveLength(4);
    });

    it("rejects unknown severities", () => {
      expect(severityEnum.safeParse("info").success).toBe(false);
      expect(severityEnum.safeParse("CRITICAL").success).toBe(false);
    });
  });

  describe("checkTypeEnum — semantic_validation added in v0.4", () => {
    const legacyCheckTypes = [
      "http_fetch",
      "schema_validation",
      "exact_match",
      "cross_evidence",
      "http_probe",
      "content_parse",
      "json_rpc",
      "header_check",
    ];

    it("accepts semantic_validation (new in v0.4)", () => {
      expect(checkTypeEnum.safeParse("semantic_validation").success).toBe(true);
    });

    it("accepts all 8 legacy check types", () => {
      for (const ct of legacyCheckTypes) {
        expect(checkTypeEnum.safeParse(ct).success).toBe(true);
      }
    });

    it("has exactly 9 check types total", () => {
      expect(checkTypeEnum.options).toHaveLength(9);
    });

    it("rejects unknown check types", () => {
      expect(checkTypeEnum.safeParse("llm_check").success).toBe(false);
    });
  });

  describe("pillarEnum — unchanged (4 pillars)", () => {
    it("accepts all 4 pillars", () => {
      expect(pillarEnum.safeParse("discovery").success).toBe(true);
      expect(pillarEnum.safeParse("understandability").success).toBe(true);
      expect(pillarEnum.safeParse("executability").success).toBe(true);
      expect(pillarEnum.safeParse("verifiability").success).toBe(true);
    });

    it("has exactly 4 pillars", () => {
      expect(pillarEnum.options).toHaveLength(4);
    });
  });

  describe("statusEnum — unchanged (5 statuses + legacy MISSING)", () => {
    it("accepts all 5 canonical statuses", () => {
      for (const s of ["VERIFIED", "INFERRED", "CONFLICT", "GAP", "NOT_APPLICABLE"]) {
        expect(statusEnum.safeParse(s).success).toBe(true);
      }
    });

    it("has exactly 5 statuses", () => {
      expect(statusEnum.options).toHaveLength(5);
    });
  });

  describe("fixTypeEnum — unchanged (3 fix types)", () => {
    it("accepts all 3 fix types", () => {
      expect(fixTypeEnum.safeParse("deterministic").success).toBe(true);
      expect(fixTypeEnum.safeParse("assisted").success).toBe(true);
      expect(fixTypeEnum.safeParse("none").success).toBe(true);
    });

    it("has exactly 3 fix types", () => {
      expect(fixTypeEnum.options).toHaveLength(3);
    });
  });

  describe("Legacy compatibility — v0.3 rules still validate", () => {
    it("a legacy rule with machine_readable category and high severity is valid", () => {
      expect(categoryEnum.safeParse("machine_readable").success).toBe(true);
      expect(severityEnum.safeParse("high").success).toBe(true);
    });

    it("a new v0.4 rule with pricing category and critical severity is valid", () => {
      expect(categoryEnum.safeParse("pricing").success).toBe(true);
      expect(severityEnum.safeParse("critical").success).toBe(true);
    });

    it("a new v0.4 rule with semantic_validation check type is valid", () => {
      expect(checkTypeEnum.safeParse("semantic_validation").success).toBe(true);
    });
  });
});
