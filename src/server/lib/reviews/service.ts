/**
 * EPIC-230 (SLICE-230-3, D-230-1/5/9): review intake + public read.
 *
 * `submitReview` is the ONLY write-path for new review cases —
 * validates the body, validates every bundled evidence row (edge
 * first, never a partial write) and calls the store composite so
 * case + evidence + received events land as ONE atomic unit.
 * Replay contract identical to feedback (228 H2): stored
 * (idempotencyKey, scope) hit replays the row only when actor AND
 * body still match.
 *
 * `publicReviewProjection` is the ONLY shape a public endpoint may
 * return — the decision is projected with the hard-coded advisory
 * markers `binding:"ADVISORY_HUMAN"` + `decidedBy:"OPERATOR"`
 * (D-230-2: a review is human advice, never a signed verdict). The
 * operator's ref, assignee and INTERNAL events never leave the
 * admin surface.
 */

import { randomUUID } from "node:crypto";

import { isValidEvidenceUri } from "../knowledge/evidence";
import type { ResolvedActor } from "../agent-interaction/actor";
import { buildReviewEvent, emitReviewHooks } from "./events";
import { validateReviewEvidence, type ReviewResult } from "./evidence";
import type { ReviewStore, ReviewEvidenceInsert } from "./store";
import type {
  ReviewCaseRecord,
  ReviewDecisionRecord,
  ReviewEvidenceRecord,
} from "./types";
import { submitReviewSchema } from "./validate";

/** D-206-5 scope convention: method+routePath namespaces the key. */
export const REVIEW_DEDUPE_SCOPE = "POST:/api/v1/agent/reviews";

/** Arc 230-8 M1: per-actor idempotency namespace (see feedback). */
const scopeFor = (
  base: string,
  actorRef: string | null,
  override?: string | null,
) => override ?? `${base}:${actorRef ?? "anon"}`;

/**
 * workRef is "the URI of the work under review" — validated with
 * the SAME classifier as evidence (D-229-9 consistent). ARTIFACT_REF
 * semantics: http(s) (any host — a private deployment can be the
 * work), `internal:` or site-local `/path`; junk/control chars
 * refuse. The server never fetches it; it is a display label.
 */
export function isValidWorkRef(uri: string): boolean {
  return isValidEvidenceUri("ARTIFACT_REF", uri);
}

export async function submitReview(
  store: ReviewStore,
  raw: unknown,
  actor: ResolvedActor,
  opts?: { idempotencyKey?: string | null; dedupeScope?: string },
): Promise<
  ReviewResult<{ record: ReviewCaseRecord; duplicate: boolean }>
> {
  const parsed = submitReviewSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "invalid input",
      field: issue?.path.join("."),
    };
  }
  const input = parsed.data;
  if (!isValidWorkRef(input.workRef)) {
    return { ok: false, error: "invalid_work_ref", field: "workRef" };
  }

  // Edge-first evidence validation — a bad row refuses the whole
  // submission, never a partial case.
  const evidence: ReviewEvidenceInsert[] = [];
  for (const rawEv of input.evidence ?? []) {
    const v = validateReviewEvidence(rawEv, "AGENT");
    if (!v.ok) return v;
    evidence.push(v.insert);
  }

  const id = `rv_${randomUUID()}`;
  for (const e of evidence) e.reviewId = id;
  const events = [
    buildReviewEvent("review.submitted", "PUBLIC", {
      reviewId: id,
      actorResolution: actor.resolution,
      reviewType: input.reviewType,
      evidenceCount: evidence.length,
    }),
    buildReviewEvent("review.submitted", "INTERNAL", {
      reviewId: id,
      actor: { resolution: actor.resolution, ref: actor.actorRef },
      reviewType: input.reviewType,
      workRef: input.workRef,
      agentCriteria: input.agentCriteria ?? null,
      evidenceCount: evidence.length,
    }),
  ];

  const res = await store.submitReview(
    {
      id,
      actorResolution: actor.resolution,
      actorRef: actor.actorRef,
      dedupeScope: scopeFor(
        REVIEW_DEDUPE_SCOPE,
        actor.actorRef,
        opts?.dedupeScope,
      ),
      idempotencyKey: opts?.idempotencyKey ?? null,
      reviewType: input.reviewType,
      workRef: input.workRef,
      agentCriteria: input.agentCriteria ?? null,
    },
    evidence,
    events,
  );

  if (res.duplicate) {
    const stored = res.record;
    if ((stored.actorRef ?? null) !== (actor.actorRef ?? null)) {
      return { ok: false, error: "actor_mismatch" };
    }
    if (
      stored.reviewType !== input.reviewType ||
      stored.workRef !== input.workRef ||
      JSON.stringify(stored.agentCriteria ?? null) !==
        JSON.stringify(input.agentCriteria ?? null)
    ) {
      return { ok: false, error: "payload_mismatch" };
    }
    // Arc 230-8 M2: evidence is part of the payload contract — a
    // retry with a changed bundle must not silently drop rows.
    const storedEvidence = await store.listEvidence(stored.id);
    const norm = (e: {
      type: string;
      uri: string;
      label?: string | null;
      description?: string | null;
    }) =>
      `${e.type}${e.uri}${e.label ?? ""}${e.description ?? ""}`;
    // Multiset compare — batch rows share createdAt, so row order is
    // not part of the contract.
    const a = storedEvidence.map(norm).sort();
    const b = evidence.map(norm).sort();
    if (
      a.length !== b.length ||
      a.some((v, i) => v !== b[i])
    ) {
      return { ok: false, error: "payload_mismatch" };
    }
  } else {
    emitReviewHooks(id, events);
  }
  return { ok: true, record: res.record, duplicate: res.duplicate };
}

// ─── D-230-9 public projection ───────────────────────────────────

export interface PublicDecision {
  outcome: string;
  summary: string;
  criteriaResults: unknown;
  /** D-230-2 markers — advisory human review, never a verdict. */
  binding: "ADVISORY_HUMAN";
  decidedBy: "OPERATOR";
}

export interface PublicReviewProjection {
  id: string;
  reviewType: string;
  status: string;
  submittedAt: string;
  decidedAt?: string;
  decision?: PublicDecision;
  /** Agent's own evidence rows (AGENT side is self-disclosure). */
  evidence?: Array<{
    type: string;
    uri: string;
    label: string | null;
    description: string | null;
    submittedBy: string;
  }>;
}

function projectDecision(
  d: ReviewDecisionRecord | null,
): PublicDecision | undefined {
  if (!d) return undefined;
  // Arc 230-8 M9: per-criterion `note` is operator-internal — the
  // public rubric carries key+result only, and unknown keys never
  // pass through.
  const results = (
    Array.isArray(d.criteriaResults) ? d.criteriaResults : []
  ).flatMap((r) => {
    const row = r as { key?: unknown; result?: unknown };
    return typeof row.key === "string" && typeof row.result === "string"
      ? [{ key: row.key, result: row.result }]
      : [];
  });
  return {
    outcome: d.outcome,
    summary: d.summary,
    criteriaResults: results,
    binding: "ADVISORY_HUMAN",
    decidedBy: "OPERATOR",
  };
}

const projectEvidence = (e: ReviewEvidenceRecord) => ({
  type: e.type,
  uri: e.uri,
  label: e.label,
  description: e.description,
  submittedBy: e.submittedBy,
});

export async function publicReviewProjection(
  store: ReviewStore,
  record: ReviewCaseRecord,
): Promise<PublicReviewProjection> {
  const out: PublicReviewProjection = {
    id: record.id,
    reviewType: record.reviewType,
    status: record.status,
    submittedAt: record.createdAt,
  };
  if (record.status === "DECIDED" && record.decidedAt) {
    out.decidedAt = record.decidedAt;
    const decisions = await store.listDecisions(record.id);
    const latest = decisions.find(
      (d) => d.seq === record.latestDecisionSeq,
    );
    const projected = projectDecision(latest ?? null);
    if (projected) out.decision = projected;
  }
  const ev = await store.listEvidence(record.id);
  const agentSide = ev.filter((e) => e.submittedBy === "AGENT");
  if (agentSide.length > 0) out.evidence = agentSide.map(projectEvidence);
  return out;
}

/** Public status read — 404-shaped failure, never a leak. */
export async function getReviewStatus(
  store: ReviewStore,
  id: string,
  rec?: ReviewCaseRecord | null,
): Promise<PublicReviewProjection | null> {
  const row = rec ?? (await store.getReview(id));
  return row ? publicReviewProjection(store, row) : null;
}
