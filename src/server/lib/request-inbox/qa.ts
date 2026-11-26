import { createHash } from "node:crypto";

import {
  normalizeQuestion,
  questionHashFor,
} from "./fingerprint";
import type { RequestStore } from "./store";
import type { InboxQaPair, InboxRequestRecord } from "./types";

/**
 * EPIC-252 (SLICE-252-2, D-252-Q7): Q&A corpus materialization.
 * A request that reaches `completed` turns its payload question +
 * response into an AgentQAPair — the corpus powers the POST
 * fast-path (`qa:true`) and `GET /api/requests/qa?q=`. Janitor's
 * payload purge never touches materialized pairs.
 */

/** Extract the question text from a request payload:
 *  string → as-is; {prompt}|{question}|{text} string field → that;
 *  anything else → null. Audit H-6: JSON.stringify(payload) used to
 *  become the PUBLIC question — leaking every payload field
 *  (account/token/…) into a world-readable corpus and serving
 *  cross-kind wrong answers. Only explicit question fields materialize. */
export function payloadQuestionText(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["prompt", "question", "text"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return null;
}

/** sha256 content-hash for the 252-2 spam-flag probe:
 *  kind + normalized question text — fingerprint is compared
 *  separately by the caller. */
export function contentHashFor(
  kind: string | null,
  questionText: string,
): string {
  // NUL separator (audit M-5): un-prefixed concat let ("ab","c")
  // equal ("a","bc").
  return createHash("sha256")
    .update(`${kind ?? ""}\u0000${normalizeQuestion(questionText)}`)
    .digest("hex");
}

/** Wrap `store.transition(id, from, "completed", patch)`; on success
 *  materialize/upsert the QA pair (same questionHash bumps uses).
 *
 *  D-256-Q13 consent gate — lives INSIDE this function so both callers
 *  (ops respond AND manual state→completed) are covered: the pair is
 *  written only when the requester opted in (`publishToQa === true`),
 *  the row is not spam-flagged, and a response exists. In-flight rows
 *  predating the column carry publishToQa=false — privacy-safe default.
 */
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
  await materializeQaPairForRecord(store, record);
  return record;
}

/** SLICE-256-9 (review R-2): materialize the QA pair for a completed
 *  record when the consent gate allows it. Returns true when a pair is
 *  present afterwards (written now or already existing via hash dedupe).
 *
 *  A failed upsert must not 500 the caller — the transition already
 *  committed (audit M-2); instead we log and let the janitor leg
 *  (reMaterializeMissingQaPairs) pick the request up on its next run,
 *  so consent → publication is guaranteed eventually, not silently lost. */
export async function materializeQaPairForRecord(
  store: RequestStore,
  record: InboxRequestRecord,
): Promise<boolean> {
  const question = payloadQuestionText(record.payload);
  // Re-audit N-5: a `completed` row with no response must not write a
  // null-answer pair into the corpus — upserts only bump `uses`, so a
  // stale null would persist forever.
  if (
    !question ||
    record.publishToQa !== true ||
    record.spamFlag ||
    record.response == null
  ) {
    return false;
  }
  try {
    await store.upsertQaPair({
      // D-256-Q14: public qa_id is a fresh uuid — `qa_{requestId}`
      // leaked the bearer capability id into the public corpus.
      id: `qa_${crypto.randomUUID().replaceAll("-", "")}`,
      questionHash: questionHashFor(normalizeQuestion(question)),
      question: normalizeQuestion(question),
      response: record.response,
      sourceRequestId: record.id,
      createdAtMs: Date.now(),
    });
    return true;
  } catch (err) {
    console.warn(
      `[request-inbox] QA materialization failed for ${record.id}; ` +
        `janitor will retry:`,
      err,
    );
    return false;
  }
}

/**
 * D-256-Q14 provenance — how the pair entered the corpus.
 * Pairs minted before the consent gate derived their id as
 * `qa_{sourceRequestId}` ("legacy"); consented pairs mint a fresh
 * `qa_<uuid>` ("ops_answered").
 */
export function qaProvenance(
  pair: Pick<InboxQaPair, "id" | "sourceRequestId">,
): "ops_answered" | "legacy" {
  return pair.id === `qa_${pair.sourceRequestId}` ? "legacy" : "ops_answered";
}

/** D-256-Q14: public projection of a corpus pair for GET /qa —
 *  `questionHash`/`sourceRequestId` (a bearer capability id) are
 *  deliberately NOT included. */
export function toPublicQaResult(p: InboxQaPair) {
  return {
    id: p.id,
    qa_id: p.id,
    question: p.question,
    response: p.response,
    uses: p.uses,
    published_at: p.createdAtMs,
    provenance: qaProvenance(p),
  };
}

/** EPIC-233 (SLICE-233-2): public QA corpus search — THE code path
 *  shared by GET /api/requests/qa (REST) and agentbadge_ask (MCP).
 *  normalize → substring search → public projection; parity is
 *  structural, not tested-into. */
export async function searchPublicQa(
  requests: RequestStore,
  q: string,
  limit = 25,
) {
  const pairs = await requests.searchQa(normalizeQuestion(q), limit);
  return pairs.map(toPublicQaResult);
}

/** D-256-Q15: POST fast-path body — honest provenance: no new row
 *  was created; the answer comes from the public corpus. */
export function qaFastPathBody(pair: InboxQaPair) {
  return {
    state: "completed",
    response: pair.response,
    qa: true,
    request_created: false,
    qa_match: {
      qa_id: pair.id,
      match_method: "normalized_exact_hash" as const,
      published_at: pair.createdAtMs,
      source: "public_qa" as const,
    },
  };
}

/** JSON.stringify with object keys deep-sorted — Postgres jsonb
 *  reorders keys, so a naive stringify compare breaks honest
 *  idempotent replays on DB-backed stores (re-audit M-11). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const pairs = Object.keys(v as object)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`,
      );
    return `{${pairs.join(",")}}`;
  }
  return JSON.stringify(v);
}
