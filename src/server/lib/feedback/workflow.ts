/**
 * EPIC-230 (SLICE-230-2, D-230-4): operator workflow on feedback.
 *
 * RECEIVED --triageFeedback--> TRIAGED --resolveFeedback-->
 * ACCEPTED|DECLINED|DUPLICATE --closeFeedback--> CLOSED
 *
 * The facade validates operator input and reports honest refusals;
 * legality itself lives INSIDE the store lock (Arc R4 M-4) — a
 * direct store call cannot jump states either. `from` is the
 * DOMAIN-expected status (lost-update precondition): a stale admin
 * screen can't silently re-drive an item an operator already moved.
 * Transition events are INTERNAL: they carry the operator ref +
 * patch, and operator identity never belongs on a public event
 * (D-228-8). The public surface reads status off the record
 * (D-230-9), not the event log.
 */

import { buildFeedbackEvent, emitFeedbackHooks } from "./events";
import type { FeedbackStore, FeedbackTransitionResult } from "./store";
import type { FeedbackRecord, FeedbackStatus } from "./types";
import { triageFeedbackSchema } from "./validate";
import type { FeedbackResult } from "./service";

const eventKindFor = (to: string) =>
  to === "TRIAGED" ? "feedback.triaged" : "feedback.status_changed";

function mapRefusal(
  res: Extract<FeedbackTransitionResult, { transitioned: false }>,
): { ok: false; error: string } {
  return {
    ok: false,
    error:
      res.reason === "missing"
        ? "not_found"
        : res.reason === "illegal"
          ? "illegal_transition"
          : "status_mismatch",
  };
}

async function doTransition(
  store: FeedbackStore,
  id: string,
  from: string,
  to: FeedbackStatus,
  operatorRef: string,
  extra?: { patch?: Record<string, unknown>; reason?: string | null },
): Promise<FeedbackResult<{ record: FeedbackRecord }>> {
  const event = buildFeedbackEvent(eventKindFor(to), "INTERNAL", {
    feedbackId: id,
    from,
    to,
    actor: operatorRef,
    ...(extra?.reason != null ? { reason: extra.reason } : {}),
    ...(extra?.patch !== undefined ? { patch: extra.patch } : {}),
  });
  const res = await store.transitionFeedback(
    id,
    {
      from,
      to,
      actor: operatorRef,
      reason: extra?.reason ?? null,
      patch: (extra?.patch ?? {}) as never,
    },
    event,
  );
  if (!res.transitioned) return mapRefusal(res);
  emitFeedbackHooks(id, [event]);
  return { ok: true, record: res.record };
}

/** RECEIVED→TRIAGED — operator sets the dictionary fields + verdict. */
export async function triageFeedback(
  store: FeedbackStore,
  id: string,
  rawPatch: unknown,
  operatorRef: string,
): Promise<FeedbackResult<{ record: FeedbackRecord }>> {
  const parsed = triageFeedbackSchema.safeParse(rawPatch ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "invalid patch",
      field: issue?.path.join("."),
    };
  }
  // Drop undefined keys — `undefined` must not null out a stored
  // field the operator didn't touch; explicit `null` clears.
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  return doTransition(store, id, "RECEIVED", "TRIAGED", operatorRef, {
    patch,
  });
}

export type FeedbackResolution = "ACCEPTED" | "DECLINED" | "DUPLICATE";

/** TRIAGED→ACCEPTED|DECLINED|DUPLICATE — optional verdict patch. */
export async function resolveFeedback(
  store: FeedbackStore,
  id: string,
  to: FeedbackResolution,
  operatorRef: string,
  opts?: { suggestion?: string | null; reason?: string | null },
): Promise<FeedbackResult<{ record: FeedbackRecord }>> {
  const patch: { suggestion?: string | null } = {};
  if (opts?.suggestion !== undefined) {
    // Arc 230-8 nit: null = explicit clear (the pre-filled form makes
    // blank deliberate); a string is stored TRIMMED — validating the
    // raw input and storing it anyway was a mismatch.
    if (opts.suggestion !== null) {
      const check = triageFeedbackSchema.shape.suggestion.safeParse(
        opts.suggestion,
      );
      if (!check.success || check.data === undefined || check.data === null) {
        return { ok: false, error: "invalid suggestion", field: "suggestion" };
      }
      patch.suggestion = check.data;
    } else {
      patch.suggestion = null;
    }
  }
  return doTransition(store, id, "TRIAGED", to, operatorRef, {
    patch,
    reason: opts?.reason ?? null,
  });
}

/** ACCEPTED|DECLINED|DUPLICATE→CLOSED — terminal archive. Arc 230-8
 *  M12: the caller's observed status is the `from` (stale screen
 *  protection), not a fresh read under the lock. */
export async function closeFeedback(
  store: FeedbackStore,
  id: string,
  operatorRef: string,
  opts?: { from?: string },
): Promise<FeedbackResult<{ record: FeedbackRecord }>> {
  const from = opts?.from;
  if (
    from === undefined ||
    (from !== "ACCEPTED" && from !== "DECLINED" && from !== "DUPLICATE")
  ) {
    return { ok: false, error: "illegal_transition" };
  }
  return doTransition(store, id, from, "CLOSED", operatorRef);
}
