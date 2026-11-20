import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import type {
  KnowledgeItemRecord,
  KnowledgeStatus,
  KnowledgeStatusEventRecord,
} from "./types";

/**
 * EPIC-229 (SLICE-229-3, D-229-3): the approval state machine.
 *
 *   DRAFT ──submit──▶ PENDING ──verify──▶ VERIFIED ──publish──▶ PUBLISHED
 *     ▲                  │                    │                   │
 *     └────reject────────┘                    └──────┬────────────┘
 *                                            WITHDRAWN (terminal,
 *                                            reachable from any
 *                                            non-terminal state)
 *
 * Invariants:
 * - Every committed transition appends a KnowledgeStatusEvent IN THE
 *   SAME STORE COMPOSITE (DB adapter = one transaction) — status and
 *   audit can never diverge.
 * - VERIFIED→PUBLISHED pins `publishedVersionId = latestVersionId`;
 *   WITHDRAWN clears it. This is the ONLY layer that may touch
 *   `publishedVersionId` (domain lib 229-2 never sets it).
 * - §16.5: verify/publish require an OPERATOR actor — agent-shaped
 *   refs (did:/agt_/agent: prefixes) are refused at the lib edge, on
 *   top of the adminAuth route boundary.
 * - Illegal transitions return INVALID_TRANSITION honestly — nothing
 *   is written (CAS refusal inside the store).
 */

/** (from → set of legal targets). WITHDRAWN is terminal. */
const TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  DRAFT: new Set(["PENDING", "WITHDRAWN"]),
  PENDING: new Set(["VERIFIED", "DRAFT", "WITHDRAWN"]),
  VERIFIED: new Set(["PUBLISHED", "WITHDRAWN"]),
  PUBLISHED: new Set(["WITHDRAWN"]),
  WITHDRAWN: new Set(),
};

/** Agent-shaped actor refs — never operators (§16.5). */
const AGENT_REF_PREFIXES = ["did:", "agt_", "agent:", "agent_"] as const;

export function isOperatorActor(actorRef: string): boolean {
  if (!actorRef || actorRef.trim().length === 0) return false;
  const lower = actorRef.toLowerCase();
  return !AGENT_REF_PREFIXES.some((p) => lower.startsWith(p));
}

const EVENT_FOR: Readonly<Record<string, string>> = {
  PENDING: "knowledge.submitted",
  VERIFIED: "knowledge.verified",
  DRAFT: "knowledge.rejected", // PENDING→DRAFT only
  PUBLISHED: "knowledge.published",
  WITHDRAWN: "knowledge.withdrawn",
};

export function allowedKnowledgeTransitions(
  from: string,
): ReadonlySet<string> {
  return TRANSITIONS[from] ?? new Set();
}

/**
 * CAS transition through the store composite. `to` must be a legal
 * target of the CURRENT status — the caller's `from` expectation is
 * implicit (we read it live), and the store CAS makes races honest.
 */
export async function transitionKnowledgeItem(
  store: KnowledgeStore,
  itemId: string,
  to: KnowledgeStatus | string,
  actorRef: string,
  reason?: string | null,
): Promise<
  KnowledgeResult<{
    item: KnowledgeItemRecord;
    event: KnowledgeStatusEventRecord;
  }>
> {
  const item = await store.getItem(itemId);
  if (!item) return { ok: false, error: "not_found" };

  const from = item.status;
  const legal = TRANSITIONS[from];
  if (!legal?.has(to)) {
    return {
      ok: false,
      error: "INVALID_TRANSITION",
      field: `from=${from} to=${to}`,
    };
  }

  // §16.5 — only operator actors may move an item INTO VERIFIED or
  // PUBLISHED (submit/reject/withdraw are operator-only anyway via
  // the adminAuth boundary, but the verify/publish guard is the
  // security-critical one).
  if ((to === "VERIFIED" || to === "PUBLISHED") && !isOperatorActor(actorRef)) {
    return { ok: false, error: "ACTOR_NOT_OPERATOR" };
  }

  const res = await store.transitionItem(itemId, {
    from,
    to,
    actor: actorRef,
    reason: reason ?? null,
    publish: to === "PUBLISHED",
    unpublish: to === "WITHDRAWN",
    eventId: `kse_${randomUUID()}`,
  });
  if (!res.transitioned) {
    // Lost a race: status moved between our read and the CAS.
    return {
      ok: false,
      error: "INVALID_TRANSITION",
      field: `from=${res.item?.status ?? "?"} to=${to}`,
    };
  }

  const eventKind = EVENT_FOR[to] ?? `knowledge.${to.toLowerCase()}`;
  emitKnowledgeEvent(
    eventKind,
    { slug: res.item.slug, from, to, actor: actorRef, reason: reason ?? null },
    itemId,
  );
  return { ok: true, item: res.item, event: res.event };
}
