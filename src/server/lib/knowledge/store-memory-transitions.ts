import type {
  KnowledgeTransitionInput,
  KnowledgeTransitionResult,
} from "./store";
import { KNOWLEDGE_TRANSITIONS } from "./store";
import type { KnowledgeStatusEventRecord } from "./types";
import { nowIso, type MemoryKnowledgeData } from "./memory-data";

/**
 * EPIC-229 (SLICE-229-1): memory-side status machine — split from
 * store-memory-core (300-line file cap). The state machine lives
 * HERE, not just in the workflow facade (Arc R4 M-4): a direct
 * store call can't jump DRAFT→PUBLISHED, and approval gates derive
 * purely from `to` — caller publish/unpublish flags are ignored.
 */
export class MemoryKnowledgeTransitions {
  constructor(protected readonly data: MemoryKnowledgeData) {}
  // ─── status machine ──

  async transitionItem(
    id: string,
    input: KnowledgeTransitionInput,
  ): Promise<KnowledgeTransitionResult> {
    const item = this.data.items.get(id);
    if (!item) {
      return {
        item: null,
        event: null,
        transitioned: false,
        reason: "missing",
      };
    }
    if (item.status !== input.from) {
      return {
        item,
        event: null,
        transitioned: false,
        reason: "status_mismatch",
      };
    }
    // Arc R4 M-4: the state machine lives at this seam too — a
    // direct store call can't jump DRAFT→PUBLISHED even with a
    // forged publish:true (flags are ignored, effects derive
    // purely from `to`).
    if (KNOWLEDGE_TRANSITIONS[input.from]?.has(input.to) !== true) {
      return {
        item,
        event: null,
        transitioned: false,
        reason: "illegal",
      };
    }
    // Arc R3 M-11: gates derive purely from `to` inside the store.
    const needEvidence = input.to === "VERIFIED";
    const needSod = input.to === "VERIFIED" || input.to === "PUBLISHED";
    // Stale-page preconditions are REQUIRED for approval targets:
    // expectedVersionId for VERIFIED+PUBLISHED, plus the evidence-set
    // fingerprint for VERIFIED (Arc R3 H-2).
    if (
      (needSod && input.expectedVersionId === undefined) ||
      (needEvidence && input.expectedEvidence === undefined)
    ) {
      return {
        item,
        event: null,
        transitioned: false,
        reason: "precondition_required",
      };
    }
    if (
      input.expectedVersionId !== undefined &&
      input.expectedVersionId !== item.latestVersionId
    ) {
      return {
        item,
        event: null,
        transitioned: false,
        reason: "stale_version",
      };
    }
    // The verifier must have seen THIS evidence set — version id alone
    // can't pin it (evidence is mutable while the item is DRAFT).
    if (input.expectedEvidence !== undefined) {
      const fp = [...this.data.evidence.values()]
        .filter((e) => e.versionId === item.latestVersionId)
        .map((e) => e.id)
        .sort()
        .join("|");
      if (fp !== input.expectedEvidence) {
        return {
          item,
          event: null,
          transitioned: false,
          reason: "evidence_changed",
        };
      }
    }
    if (needEvidence) {
      let n = 0;
      for (const e of this.data.evidence.values()) {
        if (e.versionId === item.latestVersionId) n += 1;
      }
      if (n < 1) {
        return {
          item,
          event: null,
          transitioned: false,
          reason: "evidence_required",
        };
      }
    }
    if (needSod) {
      const prevTo = input.to === "VERIFIED" ? "PENDING" : "VERIFIED";
      // `>=` keeps the LAST appended match on equal createdAt (Map
      // iteration = insertion order) — random-uuid tiebreak lost
      // chronology. Canon both sides: pre-normalization rows match.
      let prevActor: string | null = null;
      let prevKey = "";
      for (const e of this.data.events.values()) {
        if (e.itemId !== id || e.to !== prevTo) continue;
        if (e.createdAt >= prevKey) {
          prevKey = e.createdAt;
          prevActor = e.actor;
        }
      }
      const canon = (s: string) => s.normalize("NFKC").toLowerCase();
      if (prevActor !== null && canon(prevActor) === canon(input.actor)) {
        return {
          item,
          event: null,
          transitioned: false,
          reason: "separation_of_duties",
        };
      }
    }
    item.status = input.to;
    // Publish effects derive from `to`, not caller flags (Arc R4 M-4).
    if (input.to === "PUBLISHED") item.publishedVersionId = item.latestVersionId;
    if (input.to === "WITHDRAWN") item.publishedVersionId = null;
    item.updatedAt = nowIso();
    const event: KnowledgeStatusEventRecord = {
      id: input.eventId ?? `kse_${crypto.randomUUID()}`,
      itemId: id,
      from: input.from,
      to: input.to,
      actor: input.actor,
      reason: input.reason ?? null,
      createdAt: item.updatedAt,
    };
    this.data.events.set(event.id, event);
    return { item, event, transitioned: true };
  }

  async listStatusEvents(itemId: string) {
    // Arc R2 M-10: stable sort + insertion-ordered Map keeps append
    // order on same-ms events — the uuid tiebreak lost chronology.
    return [...this.data.events.values()]
      .filter((e) => e.itemId === itemId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
