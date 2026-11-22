import { randomUUID } from "node:crypto";

import { isValidEvidenceUri } from "../knowledge/evidence";
import { emitReviewHooks, buildReviewEvent } from "./events";
import type { ReviewStore, ReviewEvidenceInsert } from "./store";
import type { ReviewEvidenceRecord, ReviewSubmittedBy } from "./types";
import {
  reviewEvidenceSchema,
  type ReviewEvidenceInput,
} from "./validate";

/**
 * EPIC-230 (SLICE-230-3, D-230-7): review evidence edge.
 *
 * URI semantics are "consistent with D-229-9" — the SAME classifier
 * as knowledge evidence (ipaddr.js host range, no second parser per
 * the Arc lesson). Review-specific twist: external-claim types must
 * cite a PUBLIC host; API_ENDPOINT may point anywhere (the work
 * under review can be a private deployment), ARTIFACT_REF/OTHER may
 * use `internal:` or site-local `/path` provenance.
 */

/** Types that must cite a public, fetchable host. */
export const REVIEW_HTTP_ONLY = new Set([
  "EXTERNAL_URL",
  "ONCHAIN_TX",
  "REPO_LINK",
]);

export type ReviewResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; field?: string };

/** Validate one evidence row fully (schema + URI classifier) →
 *  a store-ready insert. Shared by submit-time batch and dosylka. */
export function validateReviewEvidence(
  raw: unknown,
  submittedBy: ReviewSubmittedBy,
): ReviewResult<{ insert: ReviewEvidenceInsert }> {
  const parsed = reviewEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "invalid evidence",
      field: issue?.path.join("."),
    };
  }
  const input: ReviewEvidenceInput = parsed.data;
  if (!isValidEvidenceUri(input.type, input.uri, REVIEW_HTTP_ONLY)) {
    return { ok: false, error: "invalid_uri", field: "uri" };
  }
  return {
    ok: true,
    insert: {
      id: `revi_${randomUUID()}`,
      reviewId: "", // caller fills
      type: input.type,
      uri: input.uri,
      label: input.label ?? null,
      description: input.description ?? null,
      submittedBy,
    },
  };
}

/**
 * Two-sided append (D-230-7): AGENT rows only while PENDING_TRIAGE,
 * OPERATOR rows only while IN_REVIEW — enforced inside the store
 * unit; the ≤50 cap re-checks there too.
 */
export async function addReviewEvidence(
  store: ReviewStore,
  reviewId: string,
  rawRows: unknown[],
  submittedBy: ReviewSubmittedBy,
): Promise<ReviewResult<{ added: ReviewEvidenceRecord[] }>> {
  const inserts: ReviewEvidenceInsert[] = [];
  for (const raw of rawRows) {
    const v = validateReviewEvidence(raw, submittedBy);
    if (!v.ok) return v;
    inserts.push({ ...v.insert, reviewId });
  }
  const event = buildReviewEvent("review.evidence_added", "INTERNAL", {
    reviewId,
    submittedBy,
    count: inserts.length,
  });
  // The event travels inside the same unit — an evidence row never
  // exists without its audit entry.
  const res = await store.addEvidence(reviewId, inserts, event);
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.reason === "cap_exceeded"
          ? "evidence_cap"
          : res.reason === "not_editable"
            ? "not_editable_in_status"
            : "not_found",
    };
  }
  emitReviewHooks(reviewId, [event]);
  return { ok: true, added: res.added };
}
