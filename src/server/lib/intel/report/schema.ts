// EPIC-262 (SLICE-262-5): canonical intel report schema — backend-owned,
// signed, immutable. Two independent score surfaces (never merged,
// D-UX-Q3); evidence summary carries freshness facts (time bounds +
// provenance counts) that downstream surfaces/digest (262-27a) read.
import { z } from "zod";

export const INTEL_REPORT_SCHEMA_VERSION = "1.0" as const;

const surfaceScoreSchema = z.strictObject({
  surface: z.enum(["readiness", "exposure"]),
  score: z.number().min(0).max(100).nullable(),
  evaluable: z.number().int().min(0),
  pass: z.number().int().min(0),
  fail: z.number().int().min(0),
  warn: z.number().int().min(0),
  unknown: z.number().int().min(0),
});

const findingSchema = z.strictObject({
  rule_id: z.string().min(1),
  rule_version: z.string().min(1),
  surface: z.enum(["readiness", "exposure"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  name: z.string().min(1),
  status: z.enum(["pass", "fail", "warn", "unknown"]),
  claim: z.string(),
  reason: z.string(),
  evidence_ids: z.array(z.string().min(1)),
});

export const intelReportSchema = z.strictObject({
  schema_version: z.literal(INTEL_REPORT_SCHEMA_VERSION),
  report_id: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  site_id: z.string().min(1),
  ruleset: z.strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  scan: z.strictObject({
    scan_id: z.string().min(1),
    // decided upstream by the job runner (262-6); the assembler only
    // propagates — it never invents job state
    completeness: z.enum(["complete", "partial"]),
    generated_at: z.string().datetime(),
  }),
  evidence: z.strictObject({
    envelope_count: z.number().int().min(0),
    collected_at_min: z.string().datetime().nullable(),
    received_at_max: z.string().datetime().nullable(),
    // sparse — only classes that actually occurred (zod v4 enum-keyed
    // record would demand all four keys)
    provenance: z.record(z.string(), z.number().int().min(0)),
  }),
  findings: z.array(findingSchema),
  scores: z.strictObject({
    readiness: surfaceScoreSchema,
    exposure: surfaceScoreSchema,
  }),
  previous_hash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .nullable(),
  integrity: z.strictObject({
    content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    signature: z.strictObject({
      algorithm: z.literal("ed25519"),
      key_id: z.string().min(1),
      value: z.string().min(1),
    }),
  }),
});

export type IntelReport = z.infer<typeof intelReportSchema>;
export type IntelReportBody = Omit<IntelReport, "integrity">;
