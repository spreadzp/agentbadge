/**
 * EPIC-229 (SLICE-229-2): the status-machine contract — split from
 * types.ts (300-line file cap). The transition table is the single
 * source of truth for `from→to` legality, enforced inside the store
 * lock by BOTH backends (Arc R4 M-4); the Postgres repo carries its
 * own copy because the db package cannot import server code.
 */

import type {
  KnowledgeItemRecord,
  KnowledgeStatusEventRecord,
} from "./types";

export const KNOWLEDGE_TRANSITIONS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  DRAFT: new Set(["PENDING", "WITHDRAWN"]),
  PENDING: new Set(["VERIFIED", "DRAFT", "WITHDRAWN"]),
  VERIFIED: new Set(["PUBLISHED", "DRAFT", "WITHDRAWN"]),
  PUBLISHED: new Set(["WITHDRAWN"]),
  WITHDRAWN: new Set(),
};

export interface KnowledgeTransitionInput {
  from: string;
  to: string;
  actor: string;
  reason?: string | null;
  /** Arc R4 M-4: DEPRECATED — the store derives publish effects
   *  from `to` (PUBLISHED pins, WITHDRAWN clears); caller flags are
   *  ignored. Kept for call-site compat. */
  publish?: boolean;
  /** Same — derived from `to`; ignored. */
  unpublish?: boolean;
  eventId?: string;
  /** Arc R2 H-2: stale-page/ABA precondition — the tx refuses unless
   *  latestVersionId still equals this under the row lock.
   *  Arc R3 M-11: REQUIRED for VERIFIED/PUBLISHED (precondition_required). */
  expectedVersionId?: string;
  /** Arc R3 H-2: pins the evidence SET a reviewer saw — canonical
   *  fingerprint = sorted evidence ids of the latest version joined
   *  by "|". Recomputed under the row lock for VERIFIED; mismatch
   *  refuses "evidence_changed". REQUIRED for VERIFIED. */
  expectedEvidence?: string;
  /** Arc R2 H-2 + R3 M-11: approval gates INSIDE the CAS lock,
   *  derived purely from `to` (VERIFIED→evidence+SoD+fingerprint,
   *  PUBLISHED→SoD) — no caller flag can widen or narrow them. */
}

export type KnowledgeTransitionResult =
  | {
      item: KnowledgeItemRecord;
      event: KnowledgeStatusEventRecord;
      transitioned: true;
    }
  | {
      item: KnowledgeItemRecord | null;
      event: null;
      transitioned: false;
      reason:
        | "missing"
        | "status_mismatch"
        | "illegal"
        | "stale_version"
        | "evidence_required"
        | "evidence_changed"
        | "precondition_required"
        | "separation_of_duties";
    };

