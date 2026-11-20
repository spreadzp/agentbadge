/**
 * EPIC-228 (SLICE-228-2, D-228-6/7): operator respond + reject.
 *
 * Both are terminal transitions — `respond` writes the
 * InteractionResponse row (operator-attributed, D-228-6) +
 * `interaction.response.sent` PUBLIC event + dual-writes the legacy
 * `response` Json `{answer: body}` so 252 GET/QA keep working.
 * `reject` marks the row failed with an INTERNAL event only.
 *
 * Terminal or missing rows refuse honestly: `{ok:false, reason}`
 * with ZERO writes — the response row, events and state stay as
 * they were (replay-safe: a second POST can never fork the thread).
 */

import { randomUUID } from "node:crypto";

import type { InboxRequestRecord } from "../request-inbox/types";
import type { RequestInboxStores } from "../request-inbox/store";
import { buildEvent, emitInteractionHooks } from "./events";
import { RESPOND_BODY_MAX } from "./vocabulary";

export const REJECT_REASON_MAX = 512;

export type TerminalRefusalReason = "missing" | "terminal";

export type RespondResult =
  | { ok: true; record: InboxRequestRecord; responseId: string }
  | { ok: false; reason: TerminalRefusalReason }
  | { ok: false; error: "empty_body" | "body_too_large" };

export async function respond(
  stores: RequestInboxStores,
  requestId: string,
  operatorRef: string,
  body: unknown,
): Promise<RespondResult> {
  if (typeof body !== "string" || body.trim().length === 0) {
    return { ok: false, error: "empty_body" };
  }
  if (Buffer.byteLength(body, "utf8") > RESPOND_BODY_MAX) {
    return { ok: false, error: "body_too_large" };
  }

  const responseId = `irsp_${randomUUID()}`;
  const event = buildEvent("interaction.response.sent", "PUBLIC", {
    requestId,
    responseId,
    operatorRef,
  });
  const res = await stores.interactions.respond(
    requestId,
    { id: responseId, requestId, operatorRef, body },
    [event],
  );
  if (!res.record) return { ok: false, reason: "missing" };
  if (!res.transitioned) return { ok: false, reason: "terminal" };
  emitInteractionHooks(requestId, [event]);
  return { ok: true, record: res.record, responseId };
}

export type RejectResult =
  | { ok: true; record: InboxRequestRecord }
  | { ok: false; reason: TerminalRefusalReason }
  | { ok: false; error: "reason_too_large" };

export async function reject(
  stores: RequestInboxStores,
  requestId: string,
  operatorRef: string,
  reason?: unknown,
): Promise<RejectResult> {
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string") {
      return { ok: false, error: "reason_too_large" };
    }
    if (Buffer.byteLength(reason, "utf8") > REJECT_REASON_MAX) {
      return { ok: false, error: "reason_too_large" };
    }
  }

  const event = buildEvent("interaction.request.rejected", "INTERNAL", {
    requestId,
    operatorRef,
    reason: reason ?? null,
  });
  const res = await stores.interactions.reject(requestId, [event]);
  if (!res.record) return { ok: false, reason: "missing" };
  if (!res.transitioned) return { ok: false, reason: "terminal" };
  emitInteractionHooks(requestId, [event]);
  return { ok: true, record: res.record };
}
