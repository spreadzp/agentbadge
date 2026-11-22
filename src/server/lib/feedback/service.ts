/**
 * EPIC-230 (SLICE-230-2, D-230-1/4/9): feedback intake + public read.
 *
 * `submitFeedback` is the ONLY write-path for new feedback rows —
 * it validates the body, computes the normalized dedup key and calls
 * the store composite so row + auto-dedup link + received events
 * (PUBLIC summary + INTERNAL full) land as ONE atomic unit
 * (requests.ts precedent).
 *
 * Replay contract (arc H2 lesson): a stored (idempotencyKey, scope)
 * hit replays the FIRST row with duplicate:true — but only when the
 * actor AND the stored fields still match (different actor →
 * actor_mismatch, different body → payload_mismatch).
 */

import { randomUUID } from "node:crypto";

import type { ResolvedActor } from "../agent-interaction/actor";
import { buildFeedbackEvent, emitFeedbackHooks } from "./events";
import { normalizeFeedbackKey } from "./normalize";
import type { FeedbackStore } from "./store";
import type { FeedbackRecord } from "./types";
import { submitFeedbackSchema } from "./validate";

/** D-206-5 scope convention: method+routePath namespaces the key. */
export const FEEDBACK_DEDUPE_SCOPE = "POST:/api/v1/agent/feedback";

export type FeedbackResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; field?: string };

/** Short PUBLIC-safe excerpt — first ≤200 code points of the text. */
const excerptOf = (text: string) => [...text].slice(0, 200).join("");

export async function submitFeedback(
  store: FeedbackStore,
  raw: unknown,
  actor: ResolvedActor,
  opts?: { idempotencyKey?: string | null; dedupeScope?: string },
): Promise<
  FeedbackResult<{
    record: FeedbackRecord;
    duplicate: boolean;
    relatedTo: string | null;
  }>
> {
  const parsed = submitFeedbackSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "invalid input",
      field: issue?.path.join("."),
    };
  }
  const input = parsed.data;
  const id = `fb_${randomUUID()}`;
  const normalized = normalizeFeedbackKey(input.text, input.target);

  const events = [
    buildFeedbackEvent("feedback.received", "PUBLIC", {
      feedbackId: id,
      // The submitter reading the public log already knows their own
      // identity — disclosure of self, not a leak (228 precedent).
      actorResolution: actor.resolution,
      kind: input.kind ?? null,
      target: input.target ?? null,
      excerpt: excerptOf(input.text),
    }),
    buildFeedbackEvent("feedback.received", "INTERNAL", {
      feedbackId: id,
      actor: { resolution: actor.resolution, ref: actor.actorRef },
      kind: input.kind ?? null,
      target: input.target ?? null,
      severity: input.severity ?? null,
      text: input.text,
      normalized,
    }),
  ];

  const res = await store.submitFeedback(
    {
      id,
      actorResolution: actor.resolution,
      actorRef: actor.actorRef,
      dedupeScope: opts?.dedupeScope ?? FEEDBACK_DEDUPE_SCOPE,
      idempotencyKey: opts?.idempotencyKey ?? null,
      text: input.text,
      kind: input.kind ?? null,
      target: input.target ?? null,
      severity: input.severity ?? null,
      normalized,
    },
    events,
  );

  if (res.duplicate) {
    const stored = res.record;
    // (key, scope) alone is not the replay contract — a different
    // actor must never receive the stored ids (cross-tenant
    // disclosure via shared-NAT), and a different body must not be
    // silently dropped (228 createRequest precedent).
    if ((stored.actorRef ?? null) !== (actor.actorRef ?? null)) {
      return { ok: false, error: "actor_mismatch" };
    }
    if (
      stored.text !== input.text ||
      stored.kind !== (input.kind ?? null) ||
      stored.target !== (input.target ?? null) ||
      stored.severity !== (input.severity ?? null)
    ) {
      return { ok: false, error: "payload_mismatch" };
    }
  } else {
    emitFeedbackHooks(id, events);
  }
  return {
    ok: true,
    record: res.record,
    duplicate: res.duplicate,
    relatedTo: res.relatedTo,
  };
}

/**
 * D-230-9 public projection — the ONLY shape a public endpoint may
 * return. Deliberately omits actor fields, idempotency key, raw text,
 * normalized key and triage dictionary fields; the operator's
 * `suggestion` is the only write-back the agent ever sees.
 */
export interface PublicFeedbackProjection {
  id: string;
  status: string;
  suggestion?: string;
  createdAt: string;
  updatedAt: string;
}

export function publicFeedbackProjection(
  r: FeedbackRecord,
): PublicFeedbackProjection {
  const out: PublicFeedbackProjection = {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (r.suggestion) out.suggestion = r.suggestion;
  return out;
}

/** Public status read — 404-shaped failure, never a leak. */
export async function getFeedbackStatus(
  store: FeedbackStore,
  id: string,
): Promise<PublicFeedbackProjection | null> {
  const rec = await store.getFeedback(id);
  return rec ? publicFeedbackProjection(rec) : null;
}
