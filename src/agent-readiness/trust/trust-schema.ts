/**
 * SLICE-102-1: Trust Snapshot Zod schema.
 *
 * Matches spec v0.10 §13.1 field-by-field.
 */

import { z } from "zod";

// ── Sub-schemas ──────────────────────────────────────────────

export const profileRefSchema = z.object({
  profile_version: z.string(),
  profile_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  endpoint: z.string().url(),
});

export const evidenceRootSchema = z.object({
  assertion_count: z.number().int().nonnegative(),
  evidence_hashes: z.array(z.string().regex(/^sha256:[0-9a-f]{64}$/)),
  merkle_root: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  computed_at: z.string(),
});

export const scoreSummarySchema = z.object({
  total: z.number().min(0).max(100),
  grade: z.string(),
  verified_rules: z.number().int().nonnegative(),
  total_rules: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
});

export const domainOwnershipSchema = z.object({
  method: z.enum(["dns_txt", "well_known_file", "well_known_meta"]),
  verified: z.boolean(),
  verified_at: z.string().nullable(),
  challenge_token: z.string(),
  proof: z.string(),
});

export const snapshotIntegritySchema = z.object({
  snapshot_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  signature_algorithm: z.literal("ed25519"),
  signature: z.string(),
  public_key: z.string(),
  key_id: z.string(),
});

export const onChainSchema = z.object({
  chain: z.enum(["hedera", "base"]),
  chain_id: z.number().int().positive(),
  contract_address: z.string(),
  token_id: z.number().int().positive(),
  attested_at: z.string(),
  attested_by: z.string(),
  tx_hash: z.string(),
  revoked: z.boolean(),
});

// ── Full snapshot schema ─────────────────────────────────────

export const trustSnapshotSchema = z.object({
  snapshot_version: z.string(),
  spec_version: z.string(),
  domain: z.string(),
  generated_at: z.string(),
  profile_ref: profileRefSchema,
  evidence_root: evidenceRootSchema,
  score_summary: scoreSummarySchema,
  domain_ownership: domainOwnershipSchema,
  integrity: snapshotIntegritySchema,
  on_chain: onChainSchema.optional(),
});

// ── Verification schema (no signature, no on_chain) ──────────

export const trustSnapshotForHashingSchema = z.object({
  snapshot_version: z.string(),
  spec_version: z.string(),
  domain: z.string(),
  generated_at: z.string(),
  profile_ref: profileRefSchema,
  evidence_root: evidenceRootSchema,
  score_summary: scoreSummarySchema,
  domain_ownership: domainOwnershipSchema,
  integrity: z.object({
    snapshot_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    signature_algorithm: z.literal("ed25519"),
    public_key: z.string(),
    key_id: z.string(),
  }),
});

// ── Types ────────────────────────────────────────────────────

export type TrustSnapshot = z.infer<typeof trustSnapshotSchema>;
export type TrustSnapshotForHashing = z.infer<typeof trustSnapshotForHashingSchema>;
export type ProfileRef = z.infer<typeof profileRefSchema>;
export type EvidenceRoot = z.infer<typeof evidenceRootSchema>;
export type ScoreSummary = z.infer<typeof scoreSummarySchema>;
export type DomainOwnership = z.infer<typeof domainOwnershipSchema>;
export type SnapshotIntegrity = z.infer<typeof snapshotIntegritySchema>;
export type OnChain = z.infer<typeof onChainSchema>;

// ── Parse functions ──────────────────────────────────────────

/**
 * Parse and validate a full Trust Snapshot JSON.
 * Throws ZodError on invalid input.
 */
export function parseSnapshot(json: unknown): TrustSnapshot {
  return trustSnapshotSchema.parse(json);
}

/**
 * Parse a snapshot for hash computation (without signature and on_chain).
 * Throws ZodError on invalid input.
 */
export function parseSnapshotForVerification(json: unknown): TrustSnapshotForHashing {
  return trustSnapshotForHashingSchema.parse(json);
}
