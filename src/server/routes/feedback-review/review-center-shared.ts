/**
 * EPIC-230 (SLICE-230-5, D-230-11): shared helpers for the Review
 * Center SSR mutations — whitelist flash codes (Arc lesson 7:
 * ok/err are codes, never free text), operator-ref guard (lesson 5)
 * and pagination bounds (lesson 9). Field readers + form-token and
 * operator-shape checks reuse the 229 shared module verbatim.
 *
 * 264-8 forged-field rule (consistent across surfaces): JSON API
 * boundaries REFUSE a body `operator`/`operatorLabel` field (typed
 * 400 via rejectOperatorField — clients must fix their payload);
 * SSR form posts IGNORE a stray one (never read — the actor is the
 * credential principal, and refusing would break legitimate PRG
 * flows over a dead field).
 */

import type { Context } from "hono";

import type { AiEnvConfig } from "../../../config/env/ai-types";
import { checkBudget, resolveEffectiveMode } from "../../lib/ai/budget";
import { loadAiSuggestions } from "../../lib/ai/intake";
import type { AiSuggestionView } from "../../lib/ai/intake";
import type { AiStore } from "../../lib/ai/types";
import { FEEDBACK_STATUSES } from "../../lib/feedback/types";
import { REVIEW_STATUSES } from "../../lib/reviews/types";
import { principalId } from "../../middleware/operatorAuth";
import {
  safeErrCode,
  safeOkCode,
} from "../../../views/admin-review-center/shared";
import {
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "../admin-knowledge-ui-mutations-shared";

export {
  formStr,
  formRaw,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "../admin-knowledge-ui-mutations-shared";

export const badId = () => new Response(null, { status: 404 });

/** Codepoint-safe clip — .slice() can split a surrogate pair and
 *  jsonb refuses lone surrogates (Arc nit: UTF-16 slicing). */
export const clipCp = (s: string, n: number) => [...s].slice(0, n).join("");

/** Shared POST prelude: id → token → credential-principal actor.
 *  Returns {body, operator} or a redirect/401 Response (264-8: the
 *  operator ref is the principal.id, never a form field). */
export async function guardMutation(
  c: Context,
  queue: "feedback" | "reviews",
  rawId: string,
  idSchema: { safeParse: (v: unknown) => { success: boolean; data?: string } },
): Promise<
  | { ok: true; body: Record<string, unknown>; operator: string; id: string }
  | { ok: false; res: Response }
> {
  const id = idSchema.safeParse(rawId);
  if (!id.success || id.data === undefined) {
    return { ok: false, res: badId() };
  }
  const actor = principalId(c);
  if (actor instanceof Response) return { ok: false, res: actor };
  const body = (await c.req.parseBody()) as Record<string, unknown>;
  if (!tokenConsumed(body)) {
    return {
      ok: false,
      res: c.redirect(backTo(queue, id.data, { err: FORM_TOKEN_ERR }), 303),
    };
  }
  return { ok: true, body, operator: actor, id: id.data };
}

export const backTo = (
  queue: "feedback" | "reviews",
  id: string,
  flash: { ok?: string; err?: string },
) => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", safeErrCode(flash.err));
  else if (flash.ok) q.set("ok", safeOkCode(flash.ok));
  const qs = q.toString();
  return `/admin/review-center/${queue}/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
};

/** ?queue= param — closed set, default feedback. */
export const readQueue = (v: string | undefined): "feedback" | "reviews" =>
  v === "reviews" ? "reviews" : "feedback";

/** ?status= per queue — closed sets or "all". */
export function readStatus(
  queue: "feedback" | "reviews",
  v: string | undefined,
): { status?: string; ok: boolean } {
  const allowed =
    queue === "feedback" ? FEEDBACK_STATUSES : REVIEW_STATUSES;
  const def = queue === "feedback" ? "RECEIVED" : "PENDING_TRIAGE";
  const s = v ?? def;
  if (s === "all") return { ok: true };
  return (allowed as readonly string[]).includes(s)
    ? { status: s, ok: true }
    : { ok: false };
}

/** ?offset= — floored, bounded (Arc lesson 9). */
export const readOffset = (v: string | undefined): number => {
  if (v === undefined) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return 0;
  return n;
};

/** 232-12 H-5: render-time suggestion load — the frozen modeAtTime
 *  on the run ignores a kill flip / budget exhaustion since the
 *  run, so the route re-resolves the effective mode NOW and hands
 *  it to the loader (fail-closed gates stay honest). */
export async function loadReviewAiSuggestions(
  aiStore: AiStore | undefined,
  aiConfig: AiEnvConfig | undefined,
  reviewId: string,
): Promise<AiSuggestionView[]> {
  if (!aiStore) return [];
  const enabled = aiConfig?.enabled ?? false;
  // Delta-3 H-8: render against the review_case partition — an
  // intake flood that exhausted ITS share must not flip the
  // review suggestion gates to off.
  const budget = enabled
    ? await checkBudget(aiStore, aiConfig!, new Date(), "review_case")
    : undefined;
  const effectiveNow = (_scenario: string, declared: string) =>
    resolveEffectiveMode(declared, {
      enabled,
      budget: budget?.state ?? "ok",
    });
  return loadAiSuggestions(
    aiStore,
    reviewId,
    ["feedback_extract", "review_assist"],
    "review_case",
    effectiveNow,
  );
}

/** Delta-2 N-M3/N-H1: newest non-shadow SUCCESS review_assist run —
 *  a shadow-only or failed/skipped run must not light the queue
 *  lane ("confirm" vs "suggested" vs "manual"). */
export async function latestVisibleReviewRun(
  aiStore: AiStore | undefined,
  reviewId: string,
): Promise<"confirm" | "suggested" | "manual"> {
  if (!aiStore) return "manual";
  const run = (
    await aiStore.listRuns({
      subjectType: "review_case",
      subjectId: reviewId,
      scenario: "review_assist",
      limit: 10,
    })
  ).find((r) => r.modeAtTime !== "shadow" && r.status === "success");
  return run?.modeAtTime === "supervised"
    ? "confirm"
    : run != null
      ? "suggested"
      : "manual";
}
