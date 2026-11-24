/**
 * EPIC-231 (SLICE-231-4, D-231-2): typed source seams — the ONLY
 * call contract neighbor domains use to file demand (KnowledgeDraftPort
 * D-230-10 pattern). Each seam writes through ingestDemand with its
 * own DemandSource enum; callers never touch the store directly.
 *
 *   INTERACTION   228 operator classification — demandSignals[] items
 *                 on an inbox request (operator-observed demand; the
 *                 actor is the REQUEST's agent, never the operator).
 *   KNOWLEDGE_GAP 229 recordGap — a persisted gap is an asked-for
 *                 answer we could not serve; gaps carry no actor, so
 *                 demand lands in the unattributed ANON bucket.
 *   FEEDBACK      230 submitFeedback — kind=FEATURE is agent-declared
 *                 capability demand ("please add X").
 *
 * Soft-dep contract: seams take an explicit `DemandStore` — a null
 * store means the caller chose not to wire demand (feature-gate);
 * they are never NOT_AVAILABLE stubs because ingestDemand itself is
 * the no-DB-safe write path (memory fallback singleton).
 *
 * Replay safety: each seam derives a deterministic idempotency key
 * from (source, sourceRef, content) unless the caller passes one —
 * re-classification/re-submit replays dedupe instead of minting
 * duplicate demand.
 */

import { createHash } from "node:crypto";

import type { ActorResolution, DemandLevel } from "./types";
import type { DemandStore } from "./store";
import {
  DEMAND_TEXT_MAX,
  ingestDemand,
  type DemandIngestResult,
} from "./pipeline";

/** The demand signal's actor — resolution + nullable ref (D-228-1). */
export interface DemandSeamActor {
  resolution: ActorResolution;
  actorRef: string | null;
}

/** Codepoint-safe clamp — a seam never errors a caller on length;
 *  the verbatim text lives in the source row, demand keeps an excerpt. */
const clampText = (s: string) =>
  [...s].slice(0, DEMAND_TEXT_MAX).join("");

const shortHash = (s: string) =>
  createHash("sha256").update(s).digest("hex").slice(0, 16);

// ─── INTERACTION (228) ────────────────────────────────────────────

export interface InteractionDemandInput {
  /** One `demandSignals[]` item — the operator-observed demand text. */
  signal: string;
  /** Originating `ireq_*` request id → sourceRef. */
  requestId: string;
  /** The REQUEST's actor (D-228-1) — never the classifying operator:
   *  uniqueActors counts the agents who demanded, not the reviewer. */
  actor: DemandSeamActor;
  sessionId?: string | null;
  /** Operator-observed → default INTEREST (not agent-declared). */
  declaredLevel?: DemandLevel;
  category?: string | null;
  feature?: string | null;
  capabilityKey?: string | null;
  /** Caller-side verbatim detail (retention-bounded, O3). */
  context?: string | null;
  /** Default: seam:INTERACTION:{requestId}:{hash(signal)} — re-classify
   *  with the same signals replays instead of minting duplicates. */
  idempotencyKey?: string | null;
  now?: number;
}

export function recordInteractionDemand(
  store: DemandStore,
  input: InteractionDemandInput,
): Promise<DemandIngestResult> {
  return ingestDemand(
    store,
    {
      text: clampText(input.signal),
      context: input.context ?? null,
      declaredLevel: input.declaredLevel ?? "INTEREST",
      category: input.category ?? null,
      feature: input.feature ?? null,
      capabilityKey: input.capabilityKey ?? null,
      source: "INTERACTION",
      sourceRef: input.requestId,
      sessionId: input.sessionId ?? null,
    },
    input.actor,
    {
      idempotencyKey:
        input.idempotencyKey ??
        `seam:INTERACTION:${input.requestId}:${shortHash(input.signal)}`,
      now: input.now,
    },
  );
}

// ─── KNOWLEDGE_GAP (229) ──────────────────────────────────────────

export interface GapDemandInput {
  /** Persisted `kgap_*` id → sourceRef. */
  gapId: string;
  /** The gap's sample query (≤500c) — becomes the demand text. */
  query: string;
  /** `KnowledgeGap.capabilityRef` → capabilityKey when present. */
  capabilityRef?: string | null;
  /** Gaps carry no actor fields — omit for the honest unattributed
   *  ANON bucket; pass one only when the caller actually knows it. */
  actor?: DemandSeamActor;
  sessionId?: string | null;
  /** Asked-for answer → default INTEREST (not declared intent). */
  declaredLevel?: DemandLevel;
  /** `detected` (first sighting) vs `reopened` — distinct idempotency
   *  keys, so a gap that re-opens files exactly one re-signal. */
  reason?: "detected" | "reopened";
  /** Default: seam:KNOWLEDGE_GAP:{gapId}:{reason}. */
  idempotencyKey?: string | null;
  now?: number;
}

export function recordGapDemand(
  store: DemandStore,
  input: GapDemandInput,
): Promise<DemandIngestResult> {
  return ingestDemand(
    store,
    {
      text: clampText(input.query),
      declaredLevel: input.declaredLevel ?? "INTEREST",
      capabilityKey: input.capabilityRef ?? null,
      source: "KNOWLEDGE_GAP",
      sourceRef: input.gapId,
      sessionId: input.sessionId ?? null,
    },
    input.actor ?? { resolution: "ANON", actorRef: null },
    {
      idempotencyKey:
        input.idempotencyKey ??
        `seam:KNOWLEDGE_GAP:${input.gapId}:${input.reason ?? "detected"}`,
      now: input.now,
    },
  );
}

// ─── FEEDBACK (230) ───────────────────────────────────────────────

export interface FeedbackDemandInput {
  /** The `fb_*` row id → sourceRef. */
  feedbackId: string;
  /** The agent's suggestion text — clamped to DEMAND_TEXT_MAX. */
  text: string;
  /** Feedback's own actor fields (D-228-1). */
  actor: DemandSeamActor;
  sessionId?: string | null;
  /** kind=FEATURE means "please add X" → default INTENT (an explicit
   *  request, same claim level as POST /api/demand/request). */
  declaredLevel?: DemandLevel;
  category?: string | null;
  feature?: string | null;
  capabilityKey?: string | null;
  /** Default: seam:FEEDBACK:{feedbackId} — one demand signal per
   *  feedback row; replays of the intake never duplicate. */
  idempotencyKey?: string | null;
  now?: number;
}

export function recordFeedbackDemand(
  store: DemandStore,
  input: FeedbackDemandInput,
): Promise<DemandIngestResult> {
  return ingestDemand(
    store,
    {
      text: clampText(input.text),
      declaredLevel: input.declaredLevel ?? "INTENT",
      category: input.category ?? null,
      feature: input.feature ?? null,
      capabilityKey: input.capabilityKey ?? null,
      source: "FEEDBACK",
      sourceRef: input.feedbackId,
      sessionId: input.sessionId ?? null,
    },
    input.actor,
    {
      idempotencyKey:
        input.idempotencyKey ?? `seam:FEEDBACK:${input.feedbackId}`,
      now: input.now,
    },
  );
}
