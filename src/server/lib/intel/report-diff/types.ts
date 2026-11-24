// EPIC-262 (SLICE-262-34): signed report-diff — the CI-gate payload.
// Same trust convention as reports/attestations: a canonical,
// Ed25519-signed artefact a pipeline can verify against
// /.well-known/agentbadge-keys.json. Diff semantics are exactly
// 262-12 — statuses are facts, the diff derives at read-time.
import { z } from "zod";
import type { StatusTransition } from "../delta";

export const INTEL_REPORT_DIFF_SCHEMA_VERSION = "intel-report-diff/1" as const;

/**
 * mode — the honest state of the diff, never a faked shape:
 *  - diff:        base resolved via head.previous_hash chain
 *  - bootstrap:   head is genesis (previous_hash null) — the current
 *                 report IS the baseline, exit 0 by design
 *  - no_reports:  site has zero canonical reports yet
 *  - chain_broken: head declares a previous_hash no stored report
 *                 matches — history was tampered with or pruned; we
 *                 report the break instead of inventing a base
 */
export const reportDiffSchema = z.strictObject({
  schema_version: z.literal(INTEL_REPORT_DIFF_SCHEMA_VERSION),
  site_id: z.string().min(1),
  mode: z.enum(["diff", "bootstrap", "no_reports", "chain_broken"]),
  /** null while mode is bootstrap/no_reports — nothing to compare */
  ruleset_compatible: z.boolean().nullable(),
  base_report_id: z.string().min(1).nullable(),
  head_report_id: z.string().min(1).nullable(),
  base_content_hash: z.string().nullable(),
  head_content_hash: z.string().nullable(),
  base_ruleset: z
    .strictObject({ name: z.string(), version: z.string() })
    .nullable(),
  head_ruleset: z
    .strictObject({ name: z.string(), version: z.string() })
    .nullable(),
  new_findings: z.array(z.string()),
  closed_findings: z.array(z.string()),
  still_open: z.array(z.string()),
  score_delta: z.strictObject({
    readiness: z.number().nullable(),
    exposure: z.number().nullable(),
  }),
  /** head scores — needed by the action's min_score gate (the delta
   *  alone can't express "below the floor"). null → no report yet. */
  head_scores: z
    .strictObject({
      readiness: z.number().nullable(),
      exposure: z.number().nullable(),
    })
    .nullable(),
  generated_at: z.string().datetime(),
  signature: z.strictObject({
    algorithm: z.literal("ed25519"),
    key_id: z.string().min(1),
    value: z.string().min(1),
  }),
});

export type IntelReportDiff = z.infer<typeof reportDiffSchema>;
export type IntelReportDiffBody = Omit<IntelReportDiff, "signature">;
export type { StatusTransition };
