/**
 * EPIC-232 (SLICE-232-1, D-232-2): AiRun helpers — the append-only
 * audit seam. One row per provider call ATTEMPT including
 * failed/skipped (a run that never reached the provider is still a
 * decision worth auditing — skip reason lands on `error`).
 */

import type { AiRunInsert, AiRunRecord, AiStore } from "./types";

export function appendAiRun(
  store: AiStore,
  input: AiRunInsert,
): Promise<AiRunRecord> {
  return store.appendRun(input);
}

/** Latest run for a subject — the lazy shadow-comparison join (D-232-5). */
export function latestAiRunFor(
  store: AiStore,
  subjectType: string,
  subjectId: string,
  scenario?: string,
): Promise<AiRunRecord | null> {
  return store.latestRunFor(subjectType, subjectId, scenario);
}
