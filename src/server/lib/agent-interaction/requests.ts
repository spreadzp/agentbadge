/**
 * EPIC-228 (SLICE-228-2, D-228-3/4/10): create-request pipeline.
 *
 * `createRequest` is the ONLY write-path for new interaction rows —
 * it validates + caps the payload, snapshots it immutably, and calls
 * `submitInteraction` so request row + `interaction.request.received`
 * events (PUBLIC summary + INTERNAL full) + session touch land as
 * ONE atomic unit. A duplicate (idempotencyKey, fpHash) replays the
 * stored row with `duplicate:true` — no double events, no session
 * increment.
 */

import { createHash, randomUUID } from "node:crypto";

import type { InboxRequestRecord } from "../request-inbox/types";
import type {
  InteractionSessionRecord,
} from "../request-inbox/interaction-types";
import type { RequestInboxStores } from "../request-inbox/store";
import { canonicalJson } from "../request-inbox/qa";
import type { ResolvedActor } from "./actor";
import { buildEvent, emitInteractionHooks } from "./events";

/** Interaction intake caps — tighter than the legacy 252 envelope. */
export const INTERACTION_PAYLOAD_MAX = 64 * 1024;
export const INTERACTION_TEXT_MAX = 16 * 1024;
export const INTERACTION_ATTACHMENTS_MAX = 20;
export const CHANNEL_MAX = 64;
export const INTERACTION_KINDS = ["question", "feature", "feedback", "bug", "proposal"] as const;

const bytes = (v: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(v) ?? "", "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const CHANNEL_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export function sanitizeChannel(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > CHANNEL_MAX) {
    return "rest";
  }
  const s = raw.toLowerCase();
  return CHANNEL_RE.test(s) ? s : "rest";
}

export interface CreateRequestInput {
  /** Full inbound body — stored verbatim as the immutable payload. */
  payload: unknown;
  /** Optional kind tag (same vocabulary as the 252 intake). */
  kind?: string | null;
  actor: ResolvedActor;
  sessionId?: string | null;
  channel: string;
  fingerprint: InboxRequestRecord["fingerprint"];
  fpHash: string;
  idempotencyKey?: string | null;
  /** Absolute expiry from env.requestTtlMs (caller-owned). */
  expiresAtMs: number;
}

export type CreateRequestResult =
  | {
      ok: true;
      record: InboxRequestRecord;
      duplicate: boolean;
      session: InteractionSessionRecord | null;
    }
  | {
      ok: false;
      error:
        | "payload_too_large"
        | "invalid_kind"
        | "actor_mismatch"
        | "payload_mismatch";
    };

/** Short PUBLIC-safe excerpt — first ≤200 chars of the text field. */
function publicSummary(
  payload: unknown,
  kind: string | null,
): Record<string, unknown> {
  let excerpt: string | undefined;
  if (payload && typeof payload === "object") {
    const text = (payload as Record<string, unknown>).text;
    // Code-point slice — a UTF-16 slice can sever a surrogate pair
    // and emit an invalid string into the PUBLIC event (arc M7).
    if (typeof text === "string") excerpt = [...text].slice(0, 200).join("");
  }
  return { kind, ...(excerpt !== undefined ? { excerpt } : {}) };
}

export async function createRequest(
  stores: RequestInboxStores,
  input: CreateRequestInput,
): Promise<CreateRequestResult> {
  if (bytes(input.payload) > INTERACTION_PAYLOAD_MAX) {
    return { ok: false, error: "payload_too_large" };
  }
  if (
    input.kind != null &&
    !INTERACTION_KINDS.includes(input.kind as never)
  ) {
    return { ok: false, error: "invalid_kind" };
  }

  const id = `ireq_${randomUUID()}`;
  const kind = input.kind ?? null;
  const events = [
    buildEvent("interaction.request.received", "PUBLIC", {
      requestId: id,
      channel: input.channel,
      // The requester reading the public log already knows their own
      // identity — this is disclosure of self, not a leak.
      actorResolution: input.actor.resolution,
      ...publicSummary(input.payload, kind),
    }),
    buildEvent("interaction.request.received", "INTERNAL", {
      requestId: id,
      channel: input.channel,
      kind,
      payload: input.payload,
      payloadSha256: createHash("sha256")
        .update(JSON.stringify(input.payload) ?? "")
        .digest("hex"),
      actor: {
        resolution: input.actor.resolution,
        ref: input.actor.actorRef,
      },
    }),
  ];

  const res = await stores.interactions.submitInteraction(
    {
      id,
      state: "submitted",
      kind,
      payload: input.payload,
      fingerprint: input.fingerprint,
      fpHash: input.fpHash,
      agentId: input.actor.agentId ?? null,
      verified: input.actor.verified,
      idempotencyKey: input.idempotencyKey ?? null,
      expiresAtMs: input.expiresAtMs,
      actorResolution: input.actor.resolution,
      actorRef: input.actor.actorRef,
      sessionId: input.sessionId ?? null,
      channel: input.channel,
    },
    events,
  );

  if (res.duplicate) {
    const stored = res.record;
    // H2 (arc-audit): (key, fpHash) alone is not the replay contract —
    // a different actor must never receive the stored ids (cross-
    // tenant disclosure via shared-NAT fpHash), and a different
    // payload must not be silently dropped (legacy does 422). A
    // janitor-purged payload can't be compared — key+fpHash stands.
    if ((stored.actorRef ?? null) !== (input.actor.actorRef ?? null)) {
      return { ok: false, error: "actor_mismatch" };
    }
    if (
      stored.payload !== null &&
      canonicalJson(stored.payload) !== canonicalJson(input.payload)
    ) {
      return { ok: false, error: "payload_mismatch" };
    }
  } else {
    emitInteractionHooks(id, events);
  }
  return {
    ok: true,
    record: res.record,
    duplicate: res.duplicate,
    session: res.session ?? null,
  };
}
