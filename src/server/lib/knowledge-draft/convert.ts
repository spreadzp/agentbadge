/**
 * EPIC-230 (SLICE-230-6, D-230-10): convert a CLOSED-LOOP operator
 * outcome into a knowledge DRAFT.
 *   Feedback: only ACCEPTED converts (TRIAGED is not an endorsement).
 *   ReviewCase: only DECIDED converts (the decision is the content).
 * Arc 230-8 remediation:
 *  - H1: the mark is a CAS (`knowledgeConverted=false AND status=…
 *    AND latestDecisionSeq=…`) — a double convert or a reopen
 *    interleaving loses honestly instead of minting two drafts.
 *  - H2: the mark result is checked; a refusal compensates by
 *    withdrawing the orphaned draft (DRAFT→WITHDRAWN) and returns
 *    an honest error — nothing is left stranded.
 *  - M10: no actor identity in the body; agent text is fenced so it
 *    cannot fake the provenance block; null dict fields defaulted.
 *  - M13: ONE URI classifier (isPublicEvidenceUri) decides the
 *    evidence-type downgrade — no second parser.
 */

import type { FeedbackStore } from "../feedback/store";
import type { FeedbackRecord } from "../feedback/types";
import type { ReviewStore } from "../reviews/store";
import type { ReviewCaseRecord, ReviewEvidenceRecord } from "../reviews/types";
import { isPublicEvidenceUri } from "../knowledge/evidence";
import type { KnowledgeKind } from "../knowledge/types";
import type {
  CreateDraftInput,
  DraftEvidenceInput,
  KnowledgeDraftPort,
} from "./port";

export type ConvertResult =
  | { ok: true; knowledgeItemId: string }
  | { ok: false; error: string };

/** Codepoint-safe clip — a naive .slice() can split a surrogate pair
 *  which jsonb then refuses (Arc nit: UTF-16 slicing). */
const clip = (s: string, n: number) => {
  const cps = [...s];
  return cps.length <= n ? s : `${cps.slice(0, n - 1).join("")}…`;
};

/** Review evidence type → knowledge evidence type. Both vocabs are
 *  closed; the downgrade decision reuses the ONE public-host
 *  classifier — a public https URI stays EXTERNAL_URL, internal
 *  provenance becomes INTERNAL_DOC (Arc 230-8 M13). */
const DIRECT_TYPE_MAP: Record<string, string> = {
  EXTERNAL_URL: "EXTERNAL_URL",
  API_ENDPOINT: "API_ENDPOINT",
  ONCHAIN_TX: "ONCHAIN_TX",
};

function mapEvidenceType(e: ReviewEvidenceRecord): string {
  const direct = DIRECT_TYPE_MAP[e.type];
  if (direct !== undefined) return direct;
  return isPublicEvidenceUri(e.uri) ? "EXTERNAL_URL" : "INTERNAL_DOC";
}

function mapEvidence(rows: ReviewEvidenceRecord[]): DraftEvidenceInput[] {
  return rows.map((e) => ({
    type: mapEvidenceType(e),
    uri: e.uri,
    label: e.label,
  }));
}

export function feedbackDraftInput(fb: FeedbackRecord): CreateDraftInput {
  const firstLine = fb.text.split("\n")[0] ?? "";
  const title = clip(
    `Feedback ${fb.kind ?? "OTHER"}/${fb.target ?? "other"}: ${firstLine}`,
    200,
  );
  // M10: agent text is fenced — it cannot fake the provenance block,
  // and no submitter identity lands in publishable knowledge.
  const body = [
    "Submitted feedback:",
    "",
    "```",
    fb.text,
    "```",
    "",
    "---",
    `source: feedback ${fb.id}`,
    `kind: ${fb.kind ?? "OTHER"} · target: ${fb.target ?? "other"} · severity: ${fb.severity ?? "MEDIUM"}`,
    fb.suggestion ? `operator suggestion: ${fb.suggestion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const kind: KnowledgeKind =
    fb.kind === "BUG" || fb.kind === "DX" ? "FAQ" : "CONCEPT";
  return {
    kind,
    title,
    body,
    summary: fb.suggestion ?? undefined,
    evidence: [],
  };
}

export function reviewDraftInput(
  r: ReviewCaseRecord,
  evidence: ReviewEvidenceRecord[],
  decisions: { outcome: string; summary: string }[],
): CreateDraftInput {
  const latest = decisions[decisions.length - 1];
  const title = clip(
    `Review ${r.reviewType}: ${latest?.outcome ?? "DECIDED"} — ${r.workRef}`,
    200,
  );
  const body = [
    `workRef: ${r.workRef}`,
    `reviewType: ${r.reviewType}`,
    latest ? `outcome: ${latest.outcome}` : "",
    latest ? "decision summary:" : "",
    latest ? "```" : "",
    latest ? latest.summary : "",
    latest ? "```" : "",
    "",
    "---",
    `source: review ${r.id}`,
    `decisions: ${decisions.length} (append-only)`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return {
    kind: "CAPABILITY_DOC",
    title,
    body,
    summary: latest ? clip(latest.summary, 300) : undefined,
    evidence: mapEvidence(evidence),
  };
}

const markErr = (reason: string): ConvertResult => ({
  ok: false,
  error:
    reason === "missing"
      ? "not_found"
      : reason === "already_converted"
        ? "already_converted"
        : "status_mismatch",
});

export async function convertFeedbackToDraft(
  store: FeedbackStore,
  port: KnowledgeDraftPort,
  id: string,
  actorRef: string,
): Promise<ConvertResult> {
  const rec = await store.getFeedback(id);
  if (!rec) return { ok: false, error: "not_found" };
  if (rec.knowledgeConverted) return { ok: false, error: "already_converted" };
  if (rec.status !== "ACCEPTED") {
    return { ok: false, error: "not_convertible_status" };
  }
  const draft = await port.createDraft(feedbackDraftInput(rec), actorRef);
  if (!draft.ok) return { ok: false, error: draft.error };
  // H1: CAS — if another convert won meanwhile, this row is already
  // marked; the new item id is logged for operator cleanup.
  const mark = await store.markKnowledgeConverted(
    id,
    draft.itemId,
    {
      kind: "feedback.knowledge_converted",
      visibility: "INTERNAL",
      payload: {
        knowledgeItemId: draft.itemId,
        actor: actorRef,
        sourceRef: `feedback:${id}`,
        ...(draft.evidenceDropped
          ? { evidenceDropped: draft.evidenceDropped }
          : {}),
      },
    },
    { status: "ACCEPTED" },
  );
  if (!mark.marked) {
    // H2 compensation: the created draft is orphaned by the lost CAS
    // — withdraw it so no stranded DRAFT sits in the operator queue.
    await port.withdrawDraft(
      draft.itemId,
      actorRef,
      `feedback ${id} conversion lost CAS (${mark.reason})`,
    );
    console.warn("knowledge-draft: mark refused — orphan withdrawn", {
      feedbackId: id,
      orphanItemId: draft.itemId,
      reason: mark.reason,
    });
    return markErr(mark.reason);
  }
  return { ok: true, knowledgeItemId: draft.itemId };
}

export async function convertReviewToDraft(
  store: ReviewStore,
  port: KnowledgeDraftPort,
  id: string,
  actorRef: string,
): Promise<ConvertResult> {
  const rec = await store.getReview(id);
  if (!rec) return { ok: false, error: "not_found" };
  if (rec.knowledgeConverted) return { ok: false, error: "already_converted" };
  if (rec.status !== "DECIDED") {
    return { ok: false, error: "not_convertible_status" };
  }
  const [evidence, decisions] = await Promise.all([
    store.listEvidence(id),
    store.listDecisions(id),
  ]);
  const draft = await port.createDraft(
    reviewDraftInput(rec, evidence, decisions),
    actorRef,
  );
  if (!draft.ok) return { ok: false, error: draft.error };
  // H1+M11: CAS on status AND latestDecisionSeq — a reopen landing
  // between read and mark refuses instead of flagging the
  // superseded decision.
  const mark = await store.markKnowledgeConverted(
    id,
    draft.itemId,
    {
      kind: "review.knowledge_converted",
      visibility: "INTERNAL",
      payload: {
        knowledgeItemId: draft.itemId,
        actor: actorRef,
        sourceRef: `review:${id}`,
        ...(draft.evidenceDropped
          ? { evidenceDropped: draft.evidenceDropped }
          : {}),
      },
    },
    { status: "DECIDED", latestDecisionSeq: rec.latestDecisionSeq },
  );
  if (!mark.marked) {
    // H2 compensation: withdraw the orphan rather than leaving a
    // stranded DRAFT — the winner's marker stays authoritative.
    await port.withdrawDraft(
      draft.itemId,
      actorRef,
      `review ${id} conversion lost CAS (${mark.reason})`,
    );
    console.warn("knowledge-draft: mark refused — orphan withdrawn", {
      reviewId: id,
      orphanItemId: draft.itemId,
      reason: mark.reason,
    });
    return markErr(mark.reason);
  }
  return { ok: true, knowledgeItemId: draft.itemId };
}

/** JSON-export fallback (D-230-10): when the port is unavailable the
 *  operator can still download the would-be draft and file it by hand. */
export function draftExportPayload(
  input: CreateDraftInput,
  sourceRef: string,
): string {
  return JSON.stringify({ sourceRef, ...input }, null, 2);
}
