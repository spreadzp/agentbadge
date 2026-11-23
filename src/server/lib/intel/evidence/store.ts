// EPIC-262 (SLICE-262-3): canonical envelope persistence.
// The store keeps the SIGNED envelope verbatim (byte-exact for later
// verification), indexed for site/scan lookups, with a server-computed
// dedupeHash as the idempotency key and expiresAt as the transparent
// retention deadline (D-262-Q8 — no "archive forever").

import { createHash } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type { CanonicalEnvelope } from "./envelope";
import type { CollectorSubmission } from "./submission";

export interface IntelEnvelopeRecord {
  /** env_<ulid> — the envelope_id, same value */
  id: string;
  schemaVersion: string;
  siteId: string;
  scanId: string;
  collectorId: string;
  provenance: CanonicalEnvelope["provenance"];
  /** sha256 hex — idempotency key over site+submission content */
  dedupeHash: string;
  /** backend-stamped acceptance instant (ISO) */
  receivedAt: string;
  /** receivedAt + retention days; null = keep (dev only) */
  expiresAt: string | null;
  /** the full canonical envelope — signed, verbatim */
  envelope: CanonicalEnvelope;
}

// Dedupe over the AUTHENTICATED site + the submission's own claims.
// Envelope-side fields (envelope_id, received_at, signature) differ per
// acceptance — they must NOT participate, or retries would never match.
export function computeDedupeHash(
  submission: Pick<
    CollectorSubmission,
    | "scan_id"
    | "collector_id"
    | "collected_at"
    | "subject"
    | "payload"
    | "evidence_refs"
  >,
  siteId: string,
): string {
  return createHash("sha256")
    .update(
      canonicalizeJson({
        site_id: siteId,
        scan_id: submission.scan_id,
        collector_id: submission.collector_id,
        collected_at: submission.collected_at,
        subject: submission.subject,
        payload: submission.payload,
        evidence_refs: submission.evidence_refs,
      }),
    )
    .digest("hex");
}

export interface IntelEvidenceStore {
  backend: "memory" | "postgres";
  insert(r: IntelEnvelopeRecord): Promise<IntelEnvelopeRecord>;
  byDedupeHash(dedupeHash: string): Promise<IntelEnvelopeRecord | null>;
  byId(id: string): Promise<IntelEnvelopeRecord | null>;
  forSite(siteId: string): Promise<IntelEnvelopeRecord[]>;
  forScan(siteId: string, scanId: string): Promise<IntelEnvelopeRecord[]>;
  /** delete rows with expiresAt <= nowIso; returns count removed */
  sweep(nowIso: string): Promise<number>;
}

export function createMemoryIntelEvidenceStore(): IntelEvidenceStore {
  const byId = new Map<string, IntelEnvelopeRecord>();
  const byHash = new Map<string, string>(); // dedupeHash → id

  return {
    backend: "memory",
    async insert(r) {
      if (byHash.has(r.dedupeHash)) {
        throw new Error(`dedupe conflict: ${r.dedupeHash}`);
      }
      byId.set(r.id, r);
      byHash.set(r.dedupeHash, r.id);
      return r;
    },
    async byDedupeHash(dedupeHash) {
      const id = byHash.get(dedupeHash);
      return id ? byId.get(id)! : null;
    },
    async byId(id) {
      return byId.get(id) ?? null;
    },
    async forSite(siteId) {
      return [...byId.values()].filter((r) => r.siteId === siteId);
    },
    async forScan(siteId, scanId) {
      return [...byId.values()].filter(
        (r) => r.siteId === siteId && r.scanId === scanId,
      );
    },
    async sweep(nowIso) {
      let removed = 0;
      for (const [id, r] of byId) {
        if (r.expiresAt !== null && r.expiresAt <= nowIso) {
          byId.delete(id);
          byHash.delete(r.dedupeHash);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
