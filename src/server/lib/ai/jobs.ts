/**
 * EPIC-232 (SLICE-232-1, D-232-8): AiJob enqueue seam — the single
 * write path intake code calls (232-3 wiring puts it same-tx with the
 * intake write). Contract-guards (D-206-5): idempotencyKey dedupe via
 * the store + field caps that REFUSE oversized input — a truncated
 * subjectId/hash would silently break dedupe and shadow joins.
 */

import type { AiJobInsert, AiJobRecord, AiStore } from "./types";

/** Field caps — write-path guards (D-206-5). */
export const AI_FIELD_LIMITS = {
  scenario: 64,
  subjectType: 64,
  subjectId: 200,
  inputRef: 500,
  inputHash: 128,
  idempotencyKey: 300,
  lastError: 400,
} as const;

export class AiJobContractError extends Error {
  constructor(field: string, max: number) {
    super(`ai_job_contract: ${field} exceeds ${max} chars`);
    this.name = "AiJobContractError";
  }
}

function cap(field: keyof typeof AI_FIELD_LIMITS, v: string | null | undefined): string | null {
  if (v == null) return null;
  if (v.length > AI_FIELD_LIMITS[field]) {
    throw new AiJobContractError(field, AI_FIELD_LIMITS[field]);
  }
  return v;
}

/**
 * Enqueue an LLM job. `idempotencyKey` absent → derived as
 * `ai:{subjectType}:{subjectId}:{scenario}` — a resubmitted intake
 * write replays onto the same job instead of doubling provider calls.
 *
 * 232-12 H-8: `queueCap` refuses once `queued` jobs reach the cap —
 * an intake flood otherwise becomes an unbounded provider-call
 * liability (queued rows are promises to spend). A refused job is
 * NOT written; callers mark the result rather than invent a run.
 */
export async function enqueueAiJob(
  store: AiStore,
  input: AiJobInsert,
  opts?: { queueCap?: number; log?: (msg: string) => void },
): Promise<{
  job: AiJobRecord | null;
  duplicate: boolean;
  refused?: "queue_full";
}> {
  // Delta-2 N-H2: the cap applies per subjectType — one shared
  // bucket let an intake flood permanently starve review_assist
  // jobs (review work silently dropped at enqueue). Per-stream
  // budgets give review_case its own lane; a refusal is logged so
  // it is visible rather than silent.
  if (opts?.queueCap != null && opts.queueCap > 0) {
    const queued = await store.countJobsByStatus("queued", input.subjectType);
    if (queued >= opts.queueCap) {
      (opts.log ?? console.warn)(
        `[ai-jobs] queue_full: refused ${input.scenario} on ` +
          `${input.subjectType}:${input.subjectId} (${queued} queued)`,
      );
      return { job: null, duplicate: false, refused: "queue_full" };
    }
  }
  const idempotencyKey =
    input.idempotencyKey ??
    `ai:${input.subjectType}:${input.subjectId}:${input.scenario}`;
  const res = await store.enqueueJob({
    ...(input.id !== undefined ? { id: input.id } : {}),
    scenario: cap("scenario", input.scenario)!,
    subjectType: cap("subjectType", input.subjectType)!,
    subjectId: cap("subjectId", input.subjectId)!,
    inputRef: cap("inputRef", input.inputRef),
    inputHash: cap("inputHash", input.inputHash),
    idempotencyKey: cap("idempotencyKey", idempotencyKey),
  });
  return { job: res.job, duplicate: res.duplicate };
}

/** Truncate an error string to the audited cap (never throws). */
export function capError(err: string | null | undefined): string | null {
  if (err == null) return null;
  return err.slice(0, AI_FIELD_LIMITS.lastError);
}
