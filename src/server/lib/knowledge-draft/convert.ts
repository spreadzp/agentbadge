/**
 * EPIC-230 (SLICE-230-6, D-230-10): convert a CLOSED-LOOP operator
 * outcome into a knowledge DRAFT.
 *   Feedback: only ACCEPTED converts (TRIAGED is not an endorsement).
 *   ReviewCase: only DECIDED converts (the decision is the content).
 * Idempotent-ish: knowledgeConverted → already_converted before the
 * port call, so a double-submit can't mint a second item.
 * The source entity records knowledgeItemId + an INTERNAL
 * `*.knowledge_converted` event — conversion is an operator act,
 * never visible as a public claim.
 */

import type { FeedbackStore } from "../feedback/store";
import type { FeedbackRecord } from "../feedback/types";
import type { ReviewStore } from "../reviews/store";
import type { ReviewCaseRecord, ReviewEvidenceRecord } from "../reviews/types";
import type { KnowledgeKind } from "../knowledge/types";
import type {
  CreateDraftInput,
  DraftEvidenceInput,
  KnowledgeDraftPort,
} from "./port";

export type ConvertResult =
  | { ok: true; knowledgeItemId: string }
  | { ok: false; error: string };

const clip = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/** Review evidence type → knowledge evidence type. Both vocabs are
 *  closed; unmapped types degrade to INTERNAL_DOC only when the uri
 *  is internal-shaped, else EXTERNAL_URL. */
const EVIDENCE_TYPE_MAP: Record<string, string> = {
  EXTERNAL_URL: "EXTERNAL_URL",
  API_ENDPOINT: "API_ENDPOINT",
  ONCHAIN_TX: "ONCHAIN_TX",
  REPO_LINK: "EXTERNAL_URL",
  ARTIFACT_REF: "INTERNAL_DOC",
};

function mapEvidence(rows: ReviewEvidenceRecord[]): DraftEvidenceInput[] {
  return rows.map((e) => {
    let type = EVIDENCE_TYPE_MAP[e.type];
    if (type === undefined) {
      type = /^(https?:|internal:|\/)/.test(e.uri)
        ? e.uri.startsWith("http")
          ? "EXTERNAL_URL"
          : "INTERNAL_DOC"
        : "INTERNAL_DOC";
    }
    return { type, uri: e.uri, label: e.label };
  });
}

export function feedbackDraftInput(fb: FeedbackRecord): CreateDraftInput {
  const title = clip(
    `Feedback ${fb.kind}/${fb.target}: ${fb.text.split("\n")[0]}`,
    200,
  );
  const meta = [
    "",
    "---",
    `source: feedback ${fb.id}`,
    `actor: ${fb.actorRef ?? "anonymous"} (${fb.actorResolution})`,
    `severity: ${fb.severity}`,
    fb.suggestion ? `operator suggestion: ${fb.suggestion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const kind: KnowledgeKind =
    fb.kind === "BUG" || fb.kind === "DX" ? "FAQ" : "CONCEPT";
  return {
    kind,
    title,
    body: `${fb.text}${meta}`,
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
    latest ? `decision: ${latest.summary}` : "",
    "",
    "---",
    `source: review ${r.id}`,
    `actor: ${r.actorRef ?? "anonymous"} (${r.actorResolution})`,
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
  await store.markKnowledgeConverted(id, draft.itemId, {
    kind: "feedback.knowledge_converted",
    visibility: "INTERNAL",
    payload: {
      knowledgeItemId: draft.itemId,
      actor: actorRef,
      sourceRef: `feedback:${id}`,
    },
  });
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
  await store.markKnowledgeConverted(id, draft.itemId, {
    kind: "review.knowledge_converted",
    visibility: "INTERNAL",
    payload: {
      knowledgeItemId: draft.itemId,
      actor: actorRef,
      sourceRef: `review:${id}`,
    },
  });
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
