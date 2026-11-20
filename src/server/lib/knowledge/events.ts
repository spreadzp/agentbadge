import { logger } from "@agentbadge/passport/logger";

import { getDatabase } from "../database";

/**
 * EPIC-229 (SLICE-229-2, D-229-6): knowledge domain events.
 *
 * `knowledge.*` events are NOT written to the econ ledger (its kind
 * vocabulary is closed) and NOT persisted as audit — the audit trail
 * is `KnowledgeStatusEvent`, appended same-tx by the store. This is
 * the 228-style post-commit hook seam: fire-and-forget listeners for
 * downstream projections (gap detection, manifest regen, demand
 * signals) that must never break a business transition.
 *
 * Gated on DATABASE_ENABLED (econ-ledger/emit.ts precedent): emits
 * only fire when Postgres is the backing store — memory-mode tests
 * observe the persisted KnowledgeStatusEvent rows instead, and tests
 * can override the gate via setKnowledgeEventsGateForTests.
 */

export const KNOWLEDGE_EVENT_KINDS = [
  "knowledge.created",
  "knowledge.version_created",
  "knowledge.submitted",
  "knowledge.verified",
  "knowledge.rejected",
  "knowledge.published",
  "knowledge.withdrawn",
  "knowledge.relation_added",
  "knowledge.evidence_added",
  "knowledge.gap_detected",
] as const;
export type KnowledgeEventKind = (typeof KNOWLEDGE_EVENT_KINDS)[number];

export interface KnowledgeEvent {
  kind: KnowledgeEventKind | string;
  /** The item this event is about (gap events may omit). */
  itemId?: string;
  payload: Record<string, unknown>;
  at: string;
}

type KnowledgeEventHook = (event: KnowledgeEvent) => void | Promise<void>;

const hooks: KnowledgeEventHook[] = [];

/** Wiring seam — returns an unsubscribe fn (228 events.ts pattern). */
export function onKnowledgeEvent(fn: KnowledgeEventHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

let gateOverride: (() => boolean) | null = null;

/** Test hook — force the DATABASE_ENABLED gate on/off. */
export function setKnowledgeEventsGateForTests(
  fn: (() => boolean) | null,
): void {
  gateOverride = fn;
}

function knowledgeEventsEnabled(): boolean {
  if (gateOverride) return gateOverride();
  try {
    return getDatabase().db !== null;
  } catch {
    return false;
  }
}

/** Post-commit fan-out. Fire-and-forget — hook errors are logged,
 *  never thrown upstream. */
export function emitKnowledgeEvent(
  kind: KnowledgeEventKind | string,
  payload: Record<string, unknown>,
  itemId?: string,
): void {
  if (!knowledgeEventsEnabled()) return;
  const event: KnowledgeEvent = {
    kind,
    itemId,
    payload,
    at: new Date().toISOString(),
  };
  for (const fn of hooks) {
    try {
      const r = fn(event);
      if (r instanceof Promise) {
        r.catch((err) =>
          logger.warn("knowledge: event hook failed", {
            kind,
            itemId,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } catch (err) {
      logger.warn("knowledge: event hook threw", {
        kind,
        itemId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
