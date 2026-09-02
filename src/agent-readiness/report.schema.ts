import { z } from "zod";
import { categoryEnum } from "./shared.schema";
import { assertionSchema } from "./assertion.schema";
import { integritySchema } from "./integrity.schema";

// ─── Report envelope schema ───────────────────────────────────────────────────
// Source: AGENT-READINESS-SPEC-v0.1.md §11, agentbadge-report.schema.json

export const agentReadinessReportSchema = z.object({
  report_id: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    .describe("ULID — 26-char Crockford Base32, see spec §11"),

  schema_version: z
    .literal("0.2.0")
    .describe("Literal version pin — only '0.2.0' accepted in v0.2"),

  ruleset: z
    .object({
      name: z.literal("agent-readiness").describe("Ruleset name — always 'agent-readiness' in v0.1"),
      version: z.literal("2.0.0").describe("Ruleset semver — always '2.0.0' in v0.1"),
    })
    .describe("Reference to the ruleset used for this scan"),

  scope: z
    .object({
      agent_id: z.string().describe("Unique identifier of the scanned agent (e.g. DID or hostname)"),
      agent_version: z.string().describe("Version string of the scanned agent"),
      endpoint_base_url: z
        .string()
        .url()
        .describe("Base URL of the agent's primary HTTP endpoint"),
      timestamp: z
        .string()
        .datetime()
        .describe("ISO 8601 timestamp of when the scan was initiated"),
    })
    .describe("Scope of the scan — identifies what was scanned"),

  scanned_at: z
    .string()
    .datetime()
    .describe("ISO 8601 timestamp of scan completion"),

  previous_hash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .nullable()
    .describe("SHA-256 hash of the previous report for this scope, or null if first scan"),

  source_state: z
    .array(
      z.object({
        url: z.string().url().describe("Fetched URL"),
        etag: z.string().optional().describe("ETag header from response, if present"),
        last_modified: z.string().optional().describe("Last-Modified header, if present"),
        fetched_at: z.string().datetime().describe("ISO 8601 timestamp of fetch"),
        status_code: z.number().int().min(100).max(599).describe("HTTP status code of the fetch"),
      }),
    )
    .describe("Array of fetched resources — enables reproducibility, see spec §10"),

  score: z
    .object({
      total: z
        .number()
        .min(0)
        .max(100)
        .describe("Overall readiness score (0-100), weighted sum of category scores"),
      categories: z
        .record(categoryEnum, z.number().min(0).max(100))
        .describe("Per-category scores (0-100), keyed by category enum"),
      delta: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("Score change from previous report — omitted on first scan"),
    })
    .describe("Score block — see spec §6 for scoring model"),

  assertions: z
    .array(assertionSchema)
    .describe("Array of assertion objects — one per evaluated rule, see spec §12"),

  integrity: integritySchema.describe("Integrity block — content hash + Ed25519 signature, see spec §13"),
});

export type AgentReadinessReport = z.infer<typeof agentReadinessReportSchema>;
