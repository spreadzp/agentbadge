// EPIC-262 (SLICE-262-1): Canonical Evidence Envelope — the BACKEND-OWNED
// record. Every trust-bearing field (provenance, received_at, verifier,
// collector identity, signature) is assigned by the backend at the trust
// boundary; none of it arrives from the wire. The signature attests the
// integrity of what backend accepted — NOT the truth of the facts inside.
import { z } from "zod";
import { subjectSchema, payloadSchema } from "./shapes";
import { evidenceRefSchema } from "./refs";

export const INTEL_ENVELOPE_SCHEMA_VERSION = "1.0" as const;

// Mutually exclusive record classification (D-262-Q5). BACKEND_VERIFIED is
// earned only by an independent re-check of the fact — schema/auth passage
// is never verification.
export const provenanceEnum = z.enum([
  "EXTERNAL_OBSERVED",
  "PLUGIN_SELF_REPORTED",
  "BACKEND_VERIFIED",
  "DERIVED",
]);
export type Provenance = z.infer<typeof provenanceEnum>;

// Authenticated collector classes — provenance is a pure function of this
// (see provenance.ts); the submission cannot influence it.
export const collectorTypeEnum = z.enum([
  "external_scan",
  "wp_plugin",
  "backend_verifier",
  "deriver",
]);
export type CollectorType = z.infer<typeof collectorTypeEnum>;

export const envelopeIdSchema = z
  .string()
  .regex(/^env_[0-9A-HJKMNP-TV-Z]{26}$/, "env_ + 26-char Crockford ULID");

export const canonicalEnvelopeSchema = z
  .strictObject({
    schema_version: z.literal(INTEL_ENVELOPE_SCHEMA_VERSION),
    envelope_id: envelopeIdSchema,
    scan_id: z.string().min(1),
    site_id: z.string().min(1),
    collector: z.strictObject({
      type: collectorTypeEnum,
      id: z.string().min(1),
      version: z.string().min(1),
    }),
    // structured: WHO verified and WHAT exactly was checked
    verifier: z.strictObject({
      id: z.string().min(1),
      check_type: z.string().min(1),
    }),
    provenance: provenanceEnum,
    collected_at: z.string().datetime(), // claimed by collector
    received_at: z.string().datetime(), // backend clock only
    subject: subjectSchema,
    payload: payloadSchema,
    evidence_refs: z.array(evidenceRefSchema),
    derived_from: z.array(z.string().min(1)).optional(),
    signature: z.strictObject({
      algorithm: z.literal("ed25519"),
      key_id: z.string().min(1),
      value: z.string().min(1), // base64 64-byte Ed25519 signature
    }),
  })
  .superRefine((env, ctx) => {
    // AC #7: a derived claim without lineage is rejectable. Other classes may
    // carry derived_from voluntarily (e.g. BACKEND_VERIFIED linking to the
    // self-report it re-checked).
    if (env.provenance === "DERIVED" && (!env.derived_from || env.derived_from.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["derived_from"],
        message: "DERIVED provenance requires non-empty derived_from[]",
      });
    }
  });

export type CanonicalEnvelope = z.infer<typeof canonicalEnvelopeSchema>;
