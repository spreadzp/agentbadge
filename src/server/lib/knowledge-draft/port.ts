/**
 * EPIC-230 (SLICE-230-6, D-230-10): KnowledgeDraftPort — the soft seam
 * from feedback/review outcomes into EPIC-229 knowledge items.
 *
 * Semantics:
 *  - createDraft builds a real knowledge item + v1 in DRAFT via
 *    createKnowledgeItem (229 service) — human approval stays in the
 *    229 workflow; nothing here publishes.
 *  - evidence rows are best-effort additions on the created v1; a
 *    refused row is logged and skipped, it never sinks the draft.
 *  - withdrawDraft is the Arc 230-8 H2 compensation: when the
 *    conversion CAS loses after a draft was already created, the
 *    orphan DRAFT is withdrawn (DRAFT→WITHDRAWN, terminal) instead
 *    of sitting stranded in the operator queue.
 *  - unavailablePort() is the degraded path (port not wired) —
 *    callers surface NOT_AVAILABLE and can offer JSON export.
 */

import { addEvidence } from "../knowledge/evidence";
import { createKnowledgeItem } from "../knowledge/items";
import { transitionKnowledgeItem } from "../knowledge/workflow";
import type { KnowledgeStore } from "../knowledge/store";
import type { KnowledgeKind } from "../knowledge/types";

export interface DraftEvidenceInput {
  type: string;
  uri: string;
  label?: string | null;
}

export interface CreateDraftInput {
  kind: KnowledgeKind;
  title: string;
  body: string;
  summary?: string;
  evidence: DraftEvidenceInput[];
}

export type DraftResult =
  | { ok: true; itemId: string; evidenceDropped: number }
  | { ok: false; error: string };

export interface KnowledgeDraftPort {
  readonly available: boolean;
  createDraft(input: CreateDraftInput, actorRef: string): Promise<DraftResult>;
  /** Withdraw an orphaned DRAFT (Arc 230-8 H2). Best-effort — a
   *  failure is logged, never thrown back at the conversion path. */
  withdrawDraft(
    itemId: string,
    actorRef: string,
    reason: string,
  ): Promise<void>;
}

/** Real adapter over the shipped EPIC-229 service. */
export function knowledgeDraftPort(store: KnowledgeStore): KnowledgeDraftPort {
  return {
    available: true,
    async createDraft(input, actorRef) {
      const r = await createKnowledgeItem(
        store,
        {
          kind: input.kind,
          title: input.title,
          body: input.body,
          summary: input.summary,
        },
        actorRef,
      );
      if (!r.ok) return { ok: false, error: r.error };
      let evidenceDropped = 0;
      for (const ev of input.evidence) {
        const added = await addEvidence(store, r.version.id, {
          type: ev.type,
          uri: ev.uri,
          label: ev.label ?? null,
          addedBy: actorRef,
        }).catch(() => null);
        if (added === null || !added.ok) {
          // best-effort — the draft stands without this row, but the
          // drop is counted into the converted-event payload so the
          // operator sees it (Arc 230-8 M13).
          evidenceDropped += 1;
          console.warn("knowledge-draft: evidence row skipped", {
            itemId: r.item.id,
            uri: ev.uri,
          });
        }
      }
      return { ok: true, itemId: r.item.id, evidenceDropped };
    },
    async withdrawDraft(itemId, actorRef, reason) {
      const r = await transitionKnowledgeItem(
        store,
        itemId,
        "WITHDRAWN",
        actorRef,
        reason,
      ).catch((err) => {
        console.warn("knowledge-draft: orphan withdraw threw", {
          itemId,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      if (r !== null && !r.ok) {
        console.warn("knowledge-draft: orphan withdraw refused", {
          itemId,
          error: r.error,
        });
      }
    },
  };
}

/** Degraded port — seam not wired. Callers may JSON-export instead. */
export function unavailableDraftPort(): KnowledgeDraftPort {
  return {
    available: false,
    createDraft: () => Promise.resolve({ ok: false, error: "not_available" }),
    withdrawDraft: () => Promise.resolve(),
  };
}
