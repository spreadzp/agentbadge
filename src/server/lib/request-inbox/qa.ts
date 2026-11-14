import { createHash } from "node:crypto";

import {
  normalizeQuestion,
  questionHashFor,
} from "./fingerprint";
import type { RequestStore } from "./store";
import type { InboxRequestRecord } from "./types";

/**
 * EPIC-252 (SLICE-252-2, D-252-Q7): Q&A corpus materialization.
 * A request that reaches `completed` turns its payload question +
 * response into an AgentQAPair — the corpus powers the POST
 * fast-path (`qa:true`) and `GET /api/requests/qa?q=`. Janitor's
 * payload purge never touches materialized pairs.
 */

/** Extract the question text from a request payload:
 *  string → as-is; {prompt}|{question}|{text} string field → that;
 *  anything else → JSON form (stable enough for hashing). */
export function payloadQuestionText(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["prompt", "question", "text"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return null;
    }
  }
  return String(payload);
}

/** sha256 content-hash for the 252-2 spam-flag probe:
 *  kind + normalized question text — fingerprint is compared
 *  separately by the caller. */
export function contentHashFor(
  kind: string | null,
  questionText: string,
): string {
  return createHash("sha256")
    .update(`${kind ?? ""}${normalizeQuestion(questionText)}`)
    .digest("hex");
}

/** Wrap `store.transition(id, from, "completed", patch)`; on success
 *  materialize/upsert the QA pair (same questionHash bumps uses). */
export async function transitionWithQa(
  store: RequestStore,
  id: string,
  from: string,
  patch: {
    response?: unknown;
    respondedAtMs?: number | null;
    spamFlag?: boolean;
  },
): Promise<InboxRequestRecord | null> {
  const record = await store.transition(id, from, "completed", patch);
  if (!record) return null;
  const question = payloadQuestionText(record.payload);
  if (question) {
    await store.upsertQaPair({
      id: `qa_${record.id}`,
      questionHash: questionHashFor(normalizeQuestion(question)),
      question: normalizeQuestion(question),
      response: record.response,
      sourceRequestId: record.id,
      createdAtMs: Date.now(),
    });
  }
  return record;
}
