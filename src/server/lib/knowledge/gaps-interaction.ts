/**
 * EPIC-229 (SLICE-229-8): the EPIC-228 interaction-inbox seam —
 * split from gaps.ts (300-line file cap). A classified interaction
 * request files a knowledge gap without touching the 228 domain;
 * `sourceRef` = the ireq_* id, bounded single-line intent/cap.
 */

import type { DemandStore } from "../demand/store";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import type { KnowledgeGapRecord } from "./types";
import { noCtrlStrict } from "./types";
import { recordGap } from "./gaps";

const IREQ_REF_RE = /^ireq_[A-Za-z0-9_-]{1,80}$/;
const bounded = (s: string | null | undefined, max: number) =>
  s === null || s === undefined || (s.length <= max && noCtrlStrict(s));

export function recordInteractionGap(
  store: KnowledgeStore,
  input: {
    requestId: string;
    query: string;
    intent?: string | null;
    capabilityRef?: string | null;
  },
  deps?: { demand?: DemandStore },
): Promise<
  KnowledgeResult<{
    gap: KnowledgeGapRecord | null;
    created: boolean;
    recorded: boolean;
  }>
> {
  if (
    !IREQ_REF_RE.test(input.requestId) ||
    !bounded(input.intent, 200) ||
    !bounded(input.capabilityRef, 200)
  ) {
    return Promise.resolve({
      ok: false,
      error: "bad_source_ref",
      field: "sourceRef",
    });
  }
  return recordGap(
    store,
    {
      query: input.query,
      source: "INTERACTION_SIGNAL",
      sourceRef: input.requestId,
      intent: input.intent,
      capabilityRef: input.capabilityRef,
    },
    deps,
  );
}

