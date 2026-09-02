import { z } from "zod";
import { categoryEnum, severityEnum, checkTypeEnum, fixTypeEnum, pillarEnum } from "./shared.schema";

// ─── Rule schema ──────────────────────────────────────────────────────────────
// Source: AGENT-READINESS-SPEC-v0.1.md, agentbadge-rule.schema.json

export const agentReadinessRuleSchema = z.object({
  rule_id: z
    .string()
    .regex(/^AB-[A-Z0-9-]+$/)
    .describe("Stable rule identifier (e.g. 'AB-001', 'AB-007')"),

  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .describe("Semver of this rule's check logic — see spec §3"),

  name: z
    .string()
    .describe("Human-readable rule name"),

  category: categoryEnum,
  severity: severityEnum,

  pillar: pillarEnum
    .optional()
    .describe("Optional pillar override — if absent, pillar is derived from category via the canonical map (spec v0.2 §A.8)"),

  counted_in_score: z
    .boolean()
    .describe("If false, this rule does not contribute to score calculation"),

  applicability: z
    .object({
      condition: z.string().describe("Machine-readable condition expression"),
      description: z.string().describe("Human-readable description of when this rule applies"),
    })
    .optional()
    .describe("Optional applicability condition — if absent, rule always applies"),

  check: z.object({
    type: checkTypeEnum,
    sources: z
      .array(z.string())
      .optional()
      .describe("Array of source identifiers to fetch/compare (for http_fetch, cross_evidence)"),
    match_keys: z
      .array(z.string())
      .optional()
      .describe("Keys to match when type = exact_match or cross_evidence"),
    conflict_when: z
      .string()
      .optional()
      .describe("Condition expression describing when sources conflict (for cross_evidence)"),
    target: z
      .string()
      .optional()
      .describe("Target path or URL for http_fetch / schema_validation"),
  }).describe("Check definition — how the rule is evaluated"),

  fix: z.object({
    eligible: z
      .boolean()
      .describe("Whether AgentBadge can generate a fix for this rule"),
    type: fixTypeEnum,
    note: z
      .string()
      .optional()
      .describe("Additional context about the fix approach"),
  }).describe("Fix definition — how a failing rule can be remediated"),
});

export type AgentReadinessRule = z.infer<typeof agentReadinessRuleSchema>;
