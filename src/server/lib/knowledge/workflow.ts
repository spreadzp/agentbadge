import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import { isOperatorRef } from "./types";
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
 * - §16.5 + Arc R1 H2: verify/publish require an OPERATOR actor —
 *   isOperatorRef (allowlist shape + agent-prefix denylist) at the
 *   lib edge, on top of the adminAuth route boundary. Separation of
 *   duties: verifier ≠ submitter, publisher ≠ verifier — one ref can
 *   no longer walk an item through the whole machine alone.
 * - Arc R1 H4: entering VERIFIED requires ≥1 evidence ref on the
 *   latest version — "verified" without provenance is dishonest.
 * - Illegal transitions return INVALID_TRANSITION honestly — nothing
 *   is written (CAS refusal inside the store).
 */

/** (from → set of legal targets). WITHDRAWN is terminal.
 *  Arc R1 M14: VERIFIED→DRAFT reopens a verified-but-not-published
 *  item for corrections — the verify event stays in the audit trail
 *  and re-review is mandatory (PENDING→VERIFIED again). */
const TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  DRAFT: new Set(["PENDING", "WITHDRAWN"]),
  PENDING: new Set(["VERIFIED", "DRAFT", "WITHDRAWN"]),
  VERIFIED: new Set(["PUBLISHED", "DRAFT", "WITHDRAWN"]),
  PUBLISHED: new Set(["WITHDRAWN"]),
  WITHDRAWN: new Set(),
};

/** Arc R1 H2: operator check = shared isOperatorRef — no more
 *  bypassable prefix-only denylist (\u200b/fullwidth/agent-7). */
export function isOperatorActor(actorRef: string): boolean {
  return isOperatorRef(actorRef);
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

  // §16.5 — only operator actors may move an item INTO VERIFIED or
  // PUBLISHED (submit/reject/withdraw are operator-only anyway via
  // the adminAuth boundary, but the verify/publish guard is the
  // security-critical one). Checked BEFORE legality: an agent actor
  // gets the same refusal regardless of current status — the error
  // doesn't leak where the item actually sits.
  if ((to === "VERIFIED" || to === "PUBLISHED") && !isOperatorActor(actorRef)) {
    return { ok: false, error: "ACTOR_NOT_OPERATOR" };
  }

  const from = item.status;
  const legal = TRANSITIONS[from];
  if (!legal?.has(to)) {
    return {
      ok: false,
      error: "INVALID_TRANSITION",
      field: `from=${from} to=${to}`,
    };
  }

  // Arc R1 H4 — a version cannot be "verified" without provenance:
  // ≥1 evidence ref must sit on the version under review.
  if (to === "VERIFIED") {
    const ev = item.latestVersionId
      ? await store.listEvidence(item.latestVersionId)
      : [];
    if (ev.length === 0) {
      return { ok: false, error: "evidence_required", field: "evidence" };
    }
  }

  // Arc R1 H2 — separation of duties on the approval machine:
  // the verifier must differ from the submitter, and the publisher
  // from the verifier. Reads the persisted audit trail, not claims.
  if (to === "VERIFIED" || to === "PUBLISHED") {
    const events = await store.listStatusEvents(itemId);
    const prior =
      to === "VERIFIED"
        ? [...events].reverse().find((e) => e.to === "PENDING")
        : [...events].reverse().find((e) => e.to === "VERIFIED");
    if (prior && prior.actor === actorRef) {
      return { ok: false, error: "SEPARATION_OF_DUTIES", field: "actor" };
    }
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
