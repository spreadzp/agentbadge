import type { ReviewEvidenceRecord } from "./types";
import { REVIEW_EVIDENCE_CAP } from "./types";
import type { ReviewEvidenceInsert, ReviewEventInput } from "./store";
import type { AppendEvents, ReviewMemoryData } from "./store-memory";

/**
 * EPIC-230 (SLICE-230-1, D-230-7): memory evidence ops — the
 * two-sided gate + ≤50 cap, split per store-memory-*.ts convention.
 */

const cloneEv = (e: ReviewEvidenceRecord): ReviewEvidenceRecord => ({
  ...e,
});

export function createMemoryEvidenceOps(
  data: ReviewMemoryData,
  appendEventsMem: AppendEvents,
  now: () => string,
) {
  const { cases, evidence } = data;
  return {
    async addEvidence(
      reviewId: string,
      rows: ReviewEvidenceInsert[],
      event?: ReviewEventInput,
    ): Promise<
      | { ok: true; added: ReviewEvidenceRecord[] }
      | {
          ok: false;
          reason: "missing" | "not_editable" | "cap_exceeded";
        }
    > {
      const cur = cases.get(reviewId);
      if (!cur) return { ok: false, reason: "missing" };
      const submittedBy = rows[0]?.submittedBy ?? "AGENT";
      // D-230-7 gate: agents only while PENDING_TRIAGE, operators
      // only while IN_REVIEW — same rule as the repo lock.
      const allowed =
        submittedBy === "OPERATOR"
          ? cur.status === "IN_REVIEW"
          : cur.status === "PENDING_TRIAGE";
      if (!allowed) return { ok: false, reason: "not_editable" };
      const list = evidence.get(reviewId) ?? [];
      if (list.length + rows.length > REVIEW_EVIDENCE_CAP) {
        return { ok: false, reason: "cap_exceeded" };
      }
      const t = now();
      const added: ReviewEvidenceRecord[] = [];
      for (const e of rows) {
        const rec: ReviewEvidenceRecord = {
          id: e.id,
          reviewId,
          type: e.type,
          uri: e.uri,
          label: e.label ?? null,
          description: e.description ?? null,
          submittedBy: e.submittedBy,
          createdAt: t,
        };
        list.push(rec);
        added.push(cloneEv(rec));
      }
      evidence.set(reviewId, list);
      if (event) appendEventsMem(reviewId, [event]);
      return { ok: true, added };
    },

    async listEvidence(reviewId: string): Promise<ReviewEvidenceRecord[]> {
      return (evidence.get(reviewId) ?? []).map(cloneEv);
    },
  };
}
