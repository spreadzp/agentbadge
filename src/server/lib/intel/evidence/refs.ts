// EPIC-262 (SLICE-262-1): evidence_refs — pointers to stored artifacts.
// v1 ships no blob storage (Q62=B): the ref carries enough to verify an
// artifact later — digest + media type + size. Retention/access policy lives
// at the class level, not in this object.
import { z } from "zod";
import { createHash } from "node:crypto";

export const evidenceRefSchema = z.strictObject({
  evidence_ref_id: z.string().min(1),
  media_type: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(0),
});

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

// Verify an artifact against its ref — digest AND size must both match.
export function verifyEvidenceRefDigest(
  ref: Pick<EvidenceRef, "sha256" | "size">,
  bytes: Uint8Array,
): boolean {
  if (bytes.length !== ref.size) return false;
  return createHash("sha256").update(bytes).digest("hex") === ref.sha256;
}
