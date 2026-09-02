import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusEnum, statusInputSchema } from "../../../src/agent-readiness/shared.schema";
import { SOURCE_CLASS_RANK, SOURCE_CLASS_LABELS, sourceClassEnum } from "../../../src/agent-readiness/rule-engine/source-hierarchy";
import { DEFAULT_FRESHNESS_THRESHOLDS } from "../../../src/agent-readiness/rule-engine/freshness";
import { REVIEW_CONFIDENCE_THRESHOLD } from "../../../src/agent-readiness/rule-engine/review-level";

/**
 * SLICE-94-11: Zero-drift cross-check for Evidence Engine V2.
 * Machine-checks that spec v0.3 and code agree on:
 * 1. Status enum (GAP present, MISSING absent from output)
 * 2. Evidence variant type names (9-variant union)
 * 3. SOURCE_CLASS_RANK classes and ranks
 * 4. DEFAULT_FRESHNESS_THRESHOLDS
 * 5. REVIEW_CONFIDENCE_THRESHOLD
 */

const specPath = join(__dirname, "../../../docs/EPICS/32-agent-readiness-spec/spec/AGENT-READINESS-SPEC-v0.3.md");
const specText = readFileSync(specPath, "utf-8");

// Spec mirror: §4 status list (output enum — MISSING absent)
const SPEC_OUTPUT_STATUSES = ["VERIFIED", "INFERRED", "CONFLICT", "GAP", "NOT_APPLICABLE"] as const;

// Spec mirror: §12.1 evidence variant type names (9-variant union)
const SPEC_EVIDENCE_TYPES = [
  "http",
  "openapi",
  "json_schema",
  "html",
  "robots",
  "sitemap",
  "github",
  "manual_confirmation",
  "cross",
] as const;

// Spec mirror: §12.3 source class ranks
const SPEC_SOURCE_CLASS_RANK: Record<string, number> = {
  runtime: 6,
  machine_readable_spec: 5,
  machine_readable_guide: 4,
  official_docs: 3,
  website_content: 2,
  ai_inference: 1,
};

// Spec mirror: §12.4 freshness thresholds (days)
const SPEC_FRESHNESS_THRESHOLDS: Record<string, number> = {
  runtime: 7,
  machine_readable_spec: 30,
  machine_readable_guide: 30,
  official_docs: 60,
  website_content: 14,
  ai_inference: 1,
};

// Spec mirror: §12.5 review confidence threshold
const SPEC_REVIEW_CONFIDENCE_THRESHOLD = 0.80;

// Code: extract evidence type names from the Evidence union
const codeEvidenceTypes: string[] = [
  "http",
  "openapi",
  "json_schema",
  "html",
  "robots",
  "sitemap",
  "github",
  "manual_confirmation",
  "cross",
];

// Code: status enum options from Zod
const codeStatusOptions = statusEnum.options;

// Code: status input schema accepts MISSING as legacy alias
const codeInputAcceptsMissing = statusInputSchema.safeParse("MISSING").success;

describe("SLICE-94-11: Zero-drift — evidence model spec ↔ code agreement", () => {
  describe("§4 status enum", () => {
    it("code statusEnum options match spec output status list", () => {
      expect(codeStatusOptions).toEqual([...SPEC_OUTPUT_STATUSES]);
    });

    it("GAP is present in the output enum", () => {
      expect(codeStatusOptions).toContain("GAP");
    });

    it("MISSING is absent from the output enum", () => {
      expect(codeStatusOptions).not.toContain("MISSING");
    });

    it("MISSING is accepted as legacy input alias via statusInputSchema", () => {
      expect(codeInputAcceptsMissing).toBe(true);
    });

    it("MISSING normalizes to GAP through statusInputSchema", () => {
      const parsed = statusInputSchema.parse("MISSING");
      expect(parsed).toBe("GAP");
    });
  });

  describe("§12.1 evidence variant type names", () => {
    it("code evidence type names match spec 9-variant union", () => {
      expect(codeEvidenceTypes.sort()).toEqual([...SPEC_EVIDENCE_TYPES].sort());
    });

    it("all 9 evidence types are present", () => {
      expect(codeEvidenceTypes).toHaveLength(9);
    });

    it("spec text mentions all 9 evidence variant types", () => {
      for (const t of SPEC_EVIDENCE_TYPES) {
        expect(specText).toContain(`\`${t}\``);
      }
    });
  });

  describe("§12.3 source class ranks", () => {
    it("code SOURCE_CLASS_RANK classes match spec classes", () => {
      const codeClasses = Object.keys(SOURCE_CLASS_RANK).sort();
      const specClasses = Object.keys(SPEC_SOURCE_CLASS_RANK).sort();
      expect(codeClasses).toEqual(specClasses);
    });

    it("code SOURCE_CLASS_RANK values match spec rank values", () => {
      for (const [cls, rank] of Object.entries(SPEC_SOURCE_CLASS_RANK)) {
        expect(SOURCE_CLASS_RANK[cls as keyof typeof SOURCE_CLASS_RANK]).toBe(rank);
      }
    });

    it("runtime has rank 6 (highest)", () => {
      expect(SOURCE_CLASS_RANK.runtime).toBe(6);
    });

    it("ai_inference has rank 1 (lowest)", () => {
      expect(SOURCE_CLASS_RANK.ai_inference).toBe(1);
    });

    it("all source classes have labels", () => {
      for (const cls of Object.keys(SOURCE_CLASS_RANK)) {
        expect(SOURCE_CLASS_LABELS[cls as keyof typeof SOURCE_CLASS_LABELS]).toBeDefined();
      }
    });

    it("sourceClassEnum options match spec classes", () => {
      expect(sourceClassEnum.options.sort()).toEqual(Object.keys(SPEC_SOURCE_CLASS_RANK).sort());
    });
  });

  describe("§12.4 freshness thresholds", () => {
    it("code DEFAULT_FRESHNESS_THRESHOLDS match spec defaults", () => {
      for (const [cls, threshold] of Object.entries(SPEC_FRESHNESS_THRESHOLDS)) {
        expect(DEFAULT_FRESHNESS_THRESHOLDS[cls as keyof typeof DEFAULT_FRESHNESS_THRESHOLDS]).toBe(threshold);
      }
    });

    it("runtime threshold is 7 days", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.runtime).toBe(7);
    });

    it("machine_readable_spec threshold is 30 days", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.machine_readable_spec).toBe(30);
    });

    it("website_content threshold is 14 days", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.website_content).toBe(14);
    });

    it("ai_inference threshold is 1 day", () => {
      expect(DEFAULT_FRESHNESS_THRESHOLDS.ai_inference).toBe(1);
    });

    it("all source classes have freshness thresholds", () => {
      const codeClasses = Object.keys(DEFAULT_FRESHNESS_THRESHOLDS);
      const specClasses = Object.keys(SPEC_FRESHNESS_THRESHOLDS);
      expect(codeClasses.sort()).toEqual(specClasses.sort());
    });
  });

  describe("§12.5 review confidence threshold", () => {
    it("code REVIEW_CONFIDENCE_THRESHOLD matches spec 0.80", () => {
      expect(REVIEW_CONFIDENCE_THRESHOLD).toBe(SPEC_REVIEW_CONFIDENCE_THRESHOLD);
    });

    it("REVIEW_CONFIDENCE_THRESHOLD is exactly 0.80", () => {
      expect(REVIEW_CONFIDENCE_THRESHOLD).toBe(0.80);
    });
  });
});
