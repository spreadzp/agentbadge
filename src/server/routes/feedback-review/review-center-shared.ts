/**
 * EPIC-230 (SLICE-230-5, D-230-11): shared helpers for the Review
 * Center SSR mutations — whitelist flash codes (Arc lesson 7:
 * ok/err are codes, never free text), operator-ref guard (lesson 5)
 * and pagination bounds (lesson 9). Field readers + form-token and
 * operator-shape checks reuse the 229 shared module verbatim.
 */

import { FEEDBACK_STATUSES } from "../../lib/feedback/types";
import { REVIEW_STATUSES } from "../../lib/reviews/types";
import {
  safeErrCode,
  safeOkCode,
} from "../../../views/admin-review-center/shared";

export {
  formStr,
  formRaw,
  opOf,
  opBad,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "../admin-knowledge-ui-mutations-shared";

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
