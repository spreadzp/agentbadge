// EPIC-262 (SLICE-262-1): shared shapes for both contract schemas.
// Subject/payload/evidence_refs appear verbatim in the Collector Submission
// (untrusted) AND in the Canonical Envelope (backend-owned) — one source of
// truth keeps the two schemas from drifting.
import { z } from "zod";

// What the evidence is about. Extensible — new variants land in a schema
// minor version, never silently (closed union = unknown type is a reject).
export const subjectSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("site") }),
  z.strictObject({ type: z.literal("url"), url: z.string().min(1) }),
  z.strictObject({ type: z.literal("wp_option"), name: z.string().min(1) }),
  z.strictObject({ type: z.literal("file_path"), path: z.string().min(1) }),
]);

// Typed payload — the discriminant `type` is mandatory. Every variant is a
// strictObject so collectors cannot smuggle extra fields through the DTO.
export const payloadSchema = z.discriminatedUnion("type", [
  // hosted external scan: what an outside observer measured
  z.strictObject({
    type: z.literal("http_observation"),
    url: z.string().min(1),
    status: z.number().int().min(100).max(599),
    // requesting User-Agent when probed with a non-default one
    // (SLICE-262-4: per-UA agent matrix — additive v1 field)
    ua: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    content_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    content_type: z.string().nullable().optional(),
    resolved_ip: z.string().nullable().optional(),
  }),
  // parsed machine-readable artifact fact (robots/sitemap/llms.txt/well-known)
  z.strictObject({
    type: z.literal("document_fact"),
    doc_type: z.enum(["robots", "sitemap", "llms_txt", "well_known", "other"]),
    url: z.string().min(1),
    facts: z.record(z.string(), z.unknown()),
  }),
  // exposure surface: does a sensitive path exist (debug.log, .env, …)
  z.strictObject({
    type: z.literal("file_presence"),
    path: z.string().min(1),
    present: z.boolean(),
    detail: z.string().optional(),
  }),
  // plugin inside-diagnostics (capability reads — never executable code)
  z.strictObject({
    type: z.literal("wp_option_read"),
    name: z.string().min(1),
    value: z.unknown(),
    autoload: z.boolean().optional(),
  }),
  // backend re-check of a previously reported fact → BACKEND_VERIFIED
  z.strictObject({
    type: z.literal("verification_result"),
    outcome: z.enum(["confirmed", "refuted", "inconclusive"]),
    detail: z.string().min(1),
    target_envelope_id: z.string().min(1).optional(),
  }),
  // computed from other envelopes → DERIVED (derived_from required upstream)
  z.strictObject({
    type: z.literal("derived_assessment"),
    summary: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export type Subject = z.infer<typeof subjectSchema>;
export type Payload = z.infer<typeof payloadSchema>;
