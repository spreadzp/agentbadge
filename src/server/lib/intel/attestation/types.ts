// EPIC-262 (SLICE-262-28): attestation artifact — a small signed
// claim derived from an immutable scan report: "site X scored Y
// under ruleset V at T, valid until U". Same signing convention as
// report/envelope (JCS + Ed25519, signature-collapse input) — a
// verifier needs ONE mechanism for all three artifact classes.
import { z } from "zod";

export const INTEL_ATTESTATION_SCHEMA_VERSION = "intel-attestation/1";

const surfaceScoreSchema = z.strictObject({
  score: z.number().min(0).max(100).nullable(),
  evaluable: z.number().int().min(0),
  fail: z.number().int().min(0),
});

export const intelAttestationSchema = z.strictObject({
  schema_version: z.literal(INTEL_ATTESTATION_SCHEMA_VERSION),
  attestation_id: z
    .string()
    .regex(/^att_[0-9A-HJKMNP-TV-Z]{26}$/, "att_ + 26-char Crockford ULID"),
  site_id: z.string().min(1),
  tenant_id: z.string().min(1),
  /** ULID of the immutable report this attestation binds to. */
  report_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  scan_id: z.string().min(1),
  ruleset: z.strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  scores: z.strictObject({
    readiness: surfaceScoreSchema,
    exposure: surfaceScoreSchema,
  }),
  /**
   * Byte-for-byte copy of report.integrity.content_hash — the
   * attestation CANNOT drift from its report; a verifier resolves
   * report by id and compares the hash.
   */
  content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  issued: z.string().datetime(),
  valid_until: z.string().datetime(),
  /**
   * Stored lifecycle — expiry is DERIVED at read (valid_until < now),
   * never written. Revocation is the only mutable transition.
   */
  status: z.enum(["active", "revoked"]),
  revoked_at: z.string().datetime().nullable(),
  revoked_reason: z.string().max(500).nullable(),
  signature: z.strictObject({
    algorithm: z.literal("ed25519"),
    key_id: z.string().min(1),
    value: z.string().min(1),
  }),
});

export type IntelAttestation = z.infer<typeof intelAttestationSchema>;
export type IntelAttestationBody = Omit<IntelAttestation, "signature">;

/** Derived-at-read status — the stored `status` never holds "expired". */
export type AttestationEffectiveStatus = "active" | "expired" | "revoked";

export function effectiveStatus(
  a: Pick<IntelAttestation, "status" | "valid_until">,
  now: string,
): AttestationEffectiveStatus {
  if (a.status === "revoked") return "revoked";
  return a.valid_until > now ? "active" : "expired";
}
