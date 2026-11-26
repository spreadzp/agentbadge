/**
 * EPIC-232 (SLICE-232-12, Arc C-1): server-side validation of the
 * operator-asserted `aiRunRef` link.
 *
 * Before this gate the hidden form field was copied onto the
 * decision row verbatim — an operator could reference a run from a
 * DIFFERENT subject, a different scenario, or a shadow run that was
 * never visible (fabricated AI-endorsement corrupting the
 * agreement metrics). The contract here:
 *
 *   - run exists AND belongs to (subjectType, subjectId, scenario)
 *     — an endorsement for case A cannot be pasted onto case B;
 *   - run.modeAtTime !== "shadow" — a blind run the operator never
 *     saw cannot honestly be referenced;
 *   - run.status === "success" — only a completed suggestion can be
 *     confirmed or rejected.
 *
 * Runs are queried through listRuns (subject-scoped, newest first);
 * pagination continues until the id resolves or the subject's run
 * history is exhausted (hard cap — runaway subjects stop at 2000).
 */

import type { AiRunRecord, AiStore } from "./types";

export interface RunRefExpectation {
  subjectType: string;
  subjectId: string;
  scenario: string;
}

const PAGE = 200;
const MAX_PAGES = 10;

export async function validateAiRunRef(
  aiStore: Pick<AiStore, "listRuns">,
  runId: string,
  expected: RunRefExpectation,
): Promise<
  | { ok: true; run: AiRunRecord }
  | { ok: false; error: "invalid_ai_run_ref" }
> {
  for (let page = 0; page < MAX_PAGES; page++) {
    const runs = await aiStore.listRuns({
      subjectType: expected.subjectType,
      subjectId: expected.subjectId,
      scenario: expected.scenario,
      limit: PAGE,
      offset: page * PAGE,
    });
    const run = runs.find((r) => r.id === runId);
    if (run) {
      if (run.modeAtTime === "shadow" || run.status !== "success") {
        return { ok: false, error: "invalid_ai_run_ref" };
      }
      return { ok: true, run };
    }
    if (runs.length < PAGE) break;
  }
  return { ok: false, error: "invalid_ai_run_ref" };
}
