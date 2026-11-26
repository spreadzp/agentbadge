/**
 * EPIC-233 (SLICE-233-3, D-233-2/5/6): the shared request-submit
 * pipeline — THE single code path behind POST /api/requests (REST)
 * and agentbadge_create_task_request (MCP tool).
 *
 * Extracted from routes/agent-requests/agent-requests-api.ts. Steps:
 *   0. callback_url already validated upstream (callback-url.ts).
 *   1. QA fast-path (D-252-Q7) — corpus hit answers 200, no row.
 *   2. Idempotent replay — (idempotencyKey, fpHash) returns the stored
 *      row; key reuse with a DIFFERENT payload is a 422-class fault.
 *   3. Submit lanes (D-252-Q6, SLICE-252-7) — hard agentId|fpHash,
 *      plus anonymous soft/ip lanes.
 *   4. Persist + advisory spam probe (D-252-Q5, N-2 bounded scan).
 *
 * Rate-limit parity: the REST route and the tool wrap the SAME lane
 * instance — getSharedSubmitLanes() — so the 1/2h budget is one
 * bucket across surfaces (an agent can't double-dip REST+MCP).
 */

import { getConfig } from "../../../config/env";
import { getDatabase } from "../database";
import { pickRequestInboxStores } from "./db-stores";
import { createSubmitLanes, type SubmitLanes } from "./submit-lanes";
import {
  canonicalJson,
  contentHashFor,
  payloadQuestionText,
} from "./qa";
import { normalizeQuestion, questionHashFor } from "./fingerprint";
import type { RequestStore } from "./store";
import type {
  InboxFingerprint,
  InboxQaPair,
  InboxRequestRecord,
} from "./types";

export const DEFAULT_SUBMIT_WINDOW_MS = 2 * 60 * 60_000; // ~2h (D-252-Q6)
export const DEFAULT_SUBMIT_MAX = 1;

export interface RequestSubmitInput {
  kind: string | null;
  /** Normalized upstream via normalizeIntakePayload (string→{question},
   *  ≤256KB, jsonb-safe). */
  payload: unknown;
  publishToQa: boolean;
  /** Verified agentId (agb_ lane) or null — anonymous. */
  agentId: string | null;
  fpHash: string;
  softFpHash: string;
  ipFpHash: string | null;
  fingerprint: InboxFingerprint;
  idempotencyKey: string | null;
  /** Pre-validated by validateCallbackUrl — persisted on the row for
   *  the 233-4 webhook outbox. */
  callbackUrl: string | null;
  /** Ingress stamp for ops ("legacy" REST | "mcp-agent-interaction"). */
  channel: string | null;
}

export type RequestSubmitOutcome =
  | { kind: "fast_path"; pair: InboxQaPair }
  | { kind: "duplicate"; record: InboxRequestRecord }
  | { kind: "payload_mismatch" } // idem-key reuse, different body → 422
  | { kind: "limited"; retryAfterSec: number } // → 429 + Retry-After
  | { kind: "submitted"; record: InboxRequestRecord }
  | { kind: "store_error" }; // → 503 (lane slots refunded inside)

export function createRequestSubmitter(deps: {
  requests: RequestStore;
  ttlMs: number;
  lanes: SubmitLanes;
  now?: () => number;
  /** Spam-probe lookback — the submit window by default. */
  probeWindowMs?: number;
}) {
  const { requests, lanes } = deps;
  const now = deps.now ?? (() => Date.now());
  const probeWindowMs = deps.probeWindowMs ?? DEFAULT_SUBMIT_WINDOW_MS;

  return async function submitRequest(
    input: RequestSubmitInput,
  ): Promise<RequestSubmitOutcome> {
    // 1. QA fast-path (D-252-Q7) — no row created.
    const question = payloadQuestionText(input.payload);
    if (question) {
      const qHash = questionHashFor(normalizeQuestion(question));
      const pair = await requests.getQaByHash(qHash);
      if (pair) {
        try {
          await requests.upsertQaPair({
            id: pair.id,
            questionHash: pair.questionHash,
            question: pair.question,
            response: pair.response,
            sourceRequestId: pair.sourceRequestId,
            createdAtMs: pair.createdAtMs,
          }); // same questionHash → uses++
        } catch {
          /* uses++ is advisory — never fail the fast path (N-6) */
        }
        return { kind: "fast_path", pair };
      }
    }

    // 2. Idempotent replay — bypasses the submit limit (AAuth §11.8).
    if (input.idempotencyKey) {
      const existing = await requests.findByIdempotency(
        input.idempotencyKey,
        input.fpHash,
      );
      if (existing) {
        // Re-audit M-11: jsonb reorders keys → canonical deep-sort
        // both sides; a janitor-purged payload can't be compared,
        // so key+fpHash match is the replay contract.
        if (
          existing.payload !== null &&
          canonicalJson(existing.payload) !== canonicalJson(input.payload)
        ) {
          return { kind: "payload_mismatch" };
        }
        return { kind: "duplicate", record: existing };
      }
    }

    // 3. Submit rate-limit (D-252-Q6): hard + IP + soft lanes.
    const hit = lanes.check(
      input.agentId,
      input.fpHash,
      input.softFpHash,
      input.ipFpHash,
    );
    if (hit) return { kind: "limited", retryAfterSec: hit.retryAfterSec };

    // 4. Persist + spam-flag probe (D-252-Q5).
    const recordId = `rq_${crypto.randomUUID().replaceAll("-", "")}`;
    let record;
    try {
      ({ record } = await requests.submit({
        id: recordId,
        state: "submitted",
        kind: input.kind,
        payload: input.payload,
        fingerprint: input.fingerprint,
        fpHash: input.fpHash,
        agentId: input.agentId,
        verified: input.agentId != null,
        publishToQa: input.publishToQa,
        idempotencyKey: input.idempotencyKey,
        callbackUrl: input.callbackUrl,
        expiresAtMs: now() + deps.ttlMs,
        channel: input.channel,
      }));
    } catch {
      // Audit M-1 + re-audit N-1: store failure post-lane → 503,
      // and refund the consumed slots so the retry is not 429.
      lanes.refund(
        input.agentId,
        input.fpHash,
        input.softFpHash,
        input.ipFpHash,
      );
      return { kind: "store_error" };
    }

    if (question) {
      try {
        // Audit M-1: the spam probe is advisory — never 500 a submit.
        const hash = contentHashFor(input.kind, question);
        // N-2: bounded probe — unbounded scan = amplifier.
        const recent = await requests.listByState({
          sinceMs: now() - probeWindowMs,
          limit: 200,
        });
        const isSpam = recent.some(
          (r) =>
            r.id !== record.id &&
            r.fpHash === input.fpHash &&
            r.kind === input.kind &&
            r.payload != null &&
            contentHashFor(
              r.kind,
              payloadQuestionText(r.payload) ?? "",
            ) === hash,
        );
        if (isSpam) await requests.setSpamFlag(record.id, true);
      } catch {
        /* advisory only */
      }
    }
    return { kind: "submitted", record };
  };
}

// ─── Process-wide shared instances (one policy, one bucket) ────────
// The REST route creates private lanes only when a test injects
// custom window/max/clock; production wiring (no overrides) and the
// MCP tool both wrap the singleton → identical budget across surfaces.

let sharedLanes: SubmitLanes | null = null;
export function getSharedSubmitLanes(): SubmitLanes {
  if (!sharedLanes) {
    sharedLanes = createSubmitLanes({
      windowMs: DEFAULT_SUBMIT_WINDOW_MS,
      max: DEFAULT_SUBMIT_MAX,
    });
  }
  return sharedLanes;
}

let sharedSubmitter: ReturnType<typeof createRequestSubmitter> | null = null;
export function getSharedRequestSubmitter(): ReturnType<
  typeof createRequestSubmitter
> {
  if (!sharedSubmitter) {
    sharedSubmitter = createRequestSubmitter({
      requests: pickRequestInboxStores(getDatabase()).requests,
      ttlMs: getConfig().requestInbox.requestTtlMs,
      lanes: getSharedSubmitLanes(),
    });
  }
  return sharedSubmitter;
}
