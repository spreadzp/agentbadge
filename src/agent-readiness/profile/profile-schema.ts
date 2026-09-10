import { z } from "zod";

/**
 * SLICE-101-1: Knowledge Profile Schema (spec v0.9 §12.1).
 * Zod schemas matching the spec field-by-field.
 * Zero-drift anchor: any change to §12.1 breaks these tests.
 */

// ─── Section meta (§12.2 contract) ───

export const sectionMetaSchema = z.object({
  source: z.string(),
  confidence: z.number().min(0).max(1),
  verified_at: z.string(),
  stale: z.boolean().default(false),
  gaps: z.array(z.string()).default([]),
});

// ─── Per-section data schemas ───

export const endpointSchema = z.object({
  path: z.string(),
  method: z.string(),
  description: z.string().optional(),
});

export const capabilitiesDataSchema = z.object({
  endpoints: z.array(endpointSchema).default([]),
  protocols: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});

export const capabilitiesSectionSchema = sectionMetaSchema.extend({
  data: capabilitiesDataSchema,
});

export const authMethodSchema = z.object({
  type: z.string(),
  flows: z.array(z.string()).optional(),
  url: z.string().optional(),
});

export const authDataSchema = z.object({
  methods: z.array(authMethodSchema).default([]),
  web_bot_auth: z.boolean().optional(),
  did: z.string().optional(),
});

export const authSectionSchema = sectionMetaSchema.extend({
  data: authDataSchema,
});

export const pricingDataSchema = z.object({
  model: z.string().optional(),
  mechanism: z.string().optional(),
  asset: z.string().optional(),
  free_tier: z.boolean().optional(),
});

export const pricingSectionSchema = sectionMetaSchema.extend({
  data: pricingDataSchema,
});

export const limitsDataSchema = z.object({
  rate_limit: z.string().optional(),
  concurrent: z.number().optional(),
});

export const limitsSectionSchema = sectionMetaSchema.extend({
  data: limitsDataSchema,
});

export const errorsDataSchema = z.object({
  standard_codes: z.array(z.number()).default([]),
  error_schema: z.string().optional(),
});

export const errorsSectionSchema = sectionMetaSchema.extend({
  data: errorsDataSchema,
});

export const policiesDataSchema = z.object({
  llm_policy: z.string().optional(),
  agents_txt: z.boolean().optional(),
  robots_txt: z.boolean().optional(),
  crawling: z.string().optional(),
});

export const policiesSectionSchema = sectionMetaSchema.extend({
  data: policiesDataSchema,
});

// ─── Service ───

export const serviceSchema = z.object({
  domain: z.string(),
  base_url: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  verified_at: z.string(),
  scan_id: z.string().optional(),
});

// ─── Readiness ───

export const readinessSchema = z.object({
  score: z.number().min(0).max(100),
  grade: z.string(),
  categories: z.record(z.string(), z.number()).default({}),
  verified_rules: z.number(),
  total_rules: z.number(),
  gaps: z.number(),
  conflicts: z.number(),
});

// ─── Freshness ───

export const freshnessSchema = z.object({
  profile_generated_at: z.string(),
  oldest_evidence_days: z.number(),
  stale_sections: z.array(z.string()).default([]),
  next_refresh: z.string().optional(),
});

// ─── Evidence summary ───

export const evidenceSummarySchema = z.object({
  total_assertions: z.number().min(0),
  by_status: z.record(z.string(), z.number()).default({}),
  by_source_class: z.record(z.string(), z.number()).default({}),
  confidence_range: z.object({
    min: z.number().min(0).max(1),
    max: z.number().min(0).max(1),
    mean: z.number().min(0).max(1),
  }),
});

// ─── Top-level Knowledge Profile ───

export const knowledgeProfileSchema = z.object({
  profile_version: z.string(),
  schema_version: z.string(),
  service: serviceSchema,
  readiness: readinessSchema,
  capabilities: capabilitiesSectionSchema.optional(),
  auth: authSectionSchema.optional(),
  pricing: pricingSectionSchema.optional(),
  limits: limitsSectionSchema.optional(),
  errors: errorsSectionSchema.optional(),
  policies: policiesSectionSchema.optional(),
  freshness: freshnessSchema,
  evidence_summary: evidenceSummarySchema,
});

// ─── Types ───

export type KnowledgeProfile = z.infer<typeof knowledgeProfileSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type SectionMeta = z.infer<typeof sectionMetaSchema>;
export type CapabilitiesSection = z.infer<typeof capabilitiesSectionSchema>;
export type AuthSection = z.infer<typeof authSectionSchema>;
export type PricingSection = z.infer<typeof pricingSectionSchema>;
export type LimitsSection = z.infer<typeof limitsSectionSchema>;
export type ErrorsSection = z.infer<typeof errorsSectionSchema>;
export type PoliciesSection = z.infer<typeof policiesSectionSchema>;
export type Freshness = z.infer<typeof freshnessSchema>;
export type EvidenceSummary = z.infer<typeof evidenceSummarySchema>;

// ─── Parse helper ───

/**
 * Parse and validate a JSON string as a KnowledgeProfile.
 * Throws on invalid JSON or schema mismatch.
 */
export function parseProfile(json: string): KnowledgeProfile {
  const parsed = JSON.parse(json);
  return knowledgeProfileSchema.parse(parsed);
}
