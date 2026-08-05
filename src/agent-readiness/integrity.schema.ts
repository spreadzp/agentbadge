import { z } from "zod";

// ─── Integrity schema ─────────────────────────────────────────────────────────
// Source: AGENT-READINESS-SPEC-v0.1.md §13, agentbadge-report.schema.json integrity properties

export const integritySchema = z.object({
  algorithm: z
    .literal("sha256")
    .describe("Hash algorithm for content hash — always sha256 in v0.1"),
  canonicalization: z
    .literal("JCS-RFC8785")
    .describe("JSON Canonicalization Scheme (RFC 8785) — required before hashing"),
  content_hash: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .describe("SHA-256 of JCS-canonicalized report body (everything except the integrity block itself)"),
  signature: z.object({
    algorithm: z
      .literal("ed25519")
      .describe("Signature algorithm — always ed25519 in v0.1"),
    key_id: z
      .string()
      .describe("Identifier of the public key used for verification — references placeholder key path from KEYS.md (SLICE-32-15)"),
    value: z
      .string()
      .describe("Base64-encoded Ed25519 signature over content_hash"),
  }),
});

export type Integrity = z.infer<typeof integritySchema>;
