import { z } from "zod";
import { categoryEnum, statusEnum, severityEnum } from "./shared.schema";

// ─── Evidence sub-object ──────────────────────────────────────────────────────
export const evidenceSchema = z.object({
  source: z.string().describe("Evidence source identifier (e.g. 'openapi', 'agent_guide', 'http_fetch')"),
  detail: z.string().describe("Human-readable description of the evidence"),
});

// ─── Conflict sub-object (present only when status = CONFLICT) ────────────────
export const conflictSideSchema = z.object({
  source: z.string().describe("Evidence source of this conflicting side"),
  value: z.string().describe("The conflicting value from this source"),
});

export const conflictSchema = z.object({
  sides: z
    .array(conflictSideSchema)
    .min(2)
    .max(2)
    .describe("Exactly 2 entries describing the disagreeing sides"),
});

// ─── Assertion schema ─────────────────────────────────────────────────────────
// Source: AGENT-READINESS-SPEC-v0.1.md §12, agentbadge-report.schema.json $defs.assertion
export const assertionSchema = z.object({
  rule_id: z
    .string()
    .regex(/^AB-[A-Z0-9-]+$/)
    .describe("Stable rule identifier (e.g. 'AB-001', 'AB-007')"),
  rule_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .describe("Semver of this rule's own check logic — see spec §3"),
  category: categoryEnum,
  status: statusEnum,
  severity: severityEnum,
  counted_in_score: z
    .boolean()
    .describe("If false, this assertion does not contribute to score calculation"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("UI-only, never a scoring input — see spec §6.1"),
  evidence: z
    .array(evidenceSchema)
    .describe("Array of evidence objects justifying the assertion's status"),
  conflict: conflictSchema
    .optional()
    .describe("Present only when status = CONFLICT — see spec §5, §12.2"),
});

export type Assertion = z.infer<typeof assertionSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Conflict = z.infer<typeof conflictSchema>;
