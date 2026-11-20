/**
 * EPIC-228 (SLICE-228-2, D-228-8): public projection + internal history.
 *
 * `publicProjection` is the ONLY shape a public endpoint may return —
 * it deliberately omits every internal field: classification columns
 * (intent/topics/…), fingerprint material (fp/ip/ua/headers),
 * actorResolution/actorRef, idempotencyKey and the raw payload. The
 * response surfaces only on terminal ANSWERED, taken from the
 * dual-written legacy `response.answer` (identical to the
 * InteractionResponse body — single source at write time).
 *
 * `internalHistory` is the admin-side inverse: complete event log
 * (both visibilities) + classification snapshot + responses.
 */

import type { InboxRequestRecord } from "../request-inbox/types";
import type {
  InteractionEventRecord,
  InteractionResponseRecord,
} from "../request-inbox/interaction-types";
import { statusOfState } from "../request-inbox/interaction-types";
import type { RequestInboxStores } from "../request-inbox/store";

export interface PublicProjection {
  id: string;
  status: string;
  /** Present only when status === "ANSWERED". */
  response?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function publicProjection(r: InboxRequestRecord): PublicProjection {
  const out: PublicProjection = {
    id: r.id,
    status: statusOfState(r.state),
    createdAt: iso(r.createdAtMs),
    updatedAt: iso(r.respondedAtMs ?? r.createdAtMs),
  };
  if (r.sessionId) out.sessionId = r.sessionId;
  if (r.state === "completed" && r.response != null) {
    const answer = (r.response as Record<string, unknown>).answer;
    out.response = typeof answer === "string" ? answer : JSON.stringify(r.response);
  }
  return out;
}

export interface InternalHistory {
  request: InboxRequestRecord;
  events: InteractionEventRecord[];
  responses: InteractionResponseRecord[];
  classification: {
    intent: string | null;
    signalType: string | null;
    outcome: string | null;
    knowledgeGap: boolean;
    topics: unknown;
    entities: unknown;
    demandSignals: unknown;
    classifiedBy: string | null;
  };
}

export async function internalHistory(
  stores: RequestInboxStores,
  requestId: string,
): Promise<InternalHistory | null> {
  const { record: request } = await stores.requests.get(requestId);
  if (!request) return null;
  const [events, responses] = await Promise.all([
    stores.interactions.listEvents(requestId),
    stores.interactions.listResponses(requestId),
  ]);
  return {
    request,
    events,
    responses,
    classification: {
      intent: request.intent ?? null,
      signalType: request.signalType ?? null,
      outcome: request.outcome ?? null,
      knowledgeGap: request.knowledgeGap ?? false,
      topics: request.topics ?? null,
      entities: request.entities ?? null,
      demandSignals: request.demandSignals ?? null,
      classifiedBy: request.classifiedBy ?? null,
    },
  };
}
