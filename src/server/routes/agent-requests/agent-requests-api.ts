/**
 * EPIC-252 (SLICE-252-2): public async intake —
 *   POST /api/requests        → 202 + Location (idempotent via Idempotency-Key)
 *   GET  /api/requests/qa?q=  → QA corpus substring search
 *   GET  /api/requests/:id    → 202 (pending) | 200 {state,response} | 410 | 404
 *
 * Decisions: D-252-Q1 A2A-states · D-252-Q2 fingerprint + optional verified
 * lane (global agentKeyAuth → c.agentId) · D-252-Q5 AAuth §11.8 codes ·
 * D-252-Q6 ~1 submit/2h per agentId|fpHash · D-252-Q7 QA fast-path.
 */

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { resolveClientIp } from "../../middleware/rate-limit";
import {
  buildFingerprint,
  normalizeQuestion,
  questionHashFor,
} from "../../lib/request-inbox/fingerprint";
import {
  contentHashFor,
  payloadQuestionText,
  canonicalJson,
  qaFastPathBody,
} from "../../lib/request-inbox/qa";
import { registerQaSearchRoute } from "./agent-requests-qa-api";
import {
  createSubmitLanes,
  headerSnapshot,
  parseIntake,
  readBodyCap,
  hasJsonbUnsafe,
  BODY_MAX,
  PAYLOAD_MAX,
  META_MAX,
} from "../../lib/request-inbox/intake";
import type { RequestInboxStores } from "../../lib/request-inbox/store";
import type { RequestInboxEnvConfig } from "../../../config/env/types";

const DEFAULT_SUBMIT_WINDOW_MS = 2 * 60 * 60_000; // ~2h (D-252-Q6)
const DEFAULT_SUBMIT_MAX = 1;
const RETRY_AFTER_SEC = 5; // poll hint — how often agents should retry

export interface AgentRequestRoutesDeps {
  stores: RequestInboxStores;
  env: RequestInboxEnvConfig;
  now?: () => number; // injectable clock for tests
  submitWindowMs?: number; // submit-rate window (default 2h)
  submitMax?: number; // max NEW submits per agentId|fpHash (default 1)
  /** Anonymous soft-lane cap (IP-rotation brake, SLICE-252-7) —
   *  default max(submitMax*8, 8); verified agents skip the lane. */
  submitSoftMax?: number;
}

const agentKeyOf = (c: Context): string | null =>
  (c.get("agentId") as string | undefined) ?? null;

export function createAgentRequestRoutes(deps: AgentRequestRoutesDeps): Hono {
  // Audit M-12: short salt → low-work fpHash brute-force.
  if ((deps.env.fingerprintSalt ?? "").length < 8) {
    throw new Error("fingerprintSalt must be >= 8 chars");
  }
  const app = new Hono();
  const { stores, env } = deps;
  const now = deps.now ?? (() => Date.now());
  const lanes = createSubmitLanes({
    windowMs: deps.submitWindowMs ?? DEFAULT_SUBMIT_WINDOW_MS,
    max: deps.submitMax ?? DEFAULT_SUBMIT_MAX,
    softMax: deps.submitSoftMax,
    now,
  });

  // QA corpus search — registered BEFORE /:id so "qa" wins the param
  // slot (route lives in agent-requests-qa-api.ts — file-size guard).
  registerQaSearchRoute(app, stores.requests);

  app.get(
    "/api/requests/:id",
    describeRoute({
      summary: "Poll a request — 202 pending / 200 terminal / 410 expired",
      tags: ["Requests"],
      responses: { 200: { description: "Terminal state with response" }, 202: { description: "Still submitted/working" }, 404: { description: "Unknown request id" }, 410: { description: "Expired — must not retry" } },
    }),
    async (c) => {
      const id = c.req.param("id");
      const { record, expired } = await stores.requests.get(id);
      if (!record) {
        return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such request",);
      }
      if (expired) {
        return errorResponse(
          c,
          410,
          ErrorCodes.REQUEST_EXPIRED,
          "request expired — do not retry",
          { retryable: false },
        );
      }
      // D-256-Q16: lifecycle visibility — poll hint stays honest
      // (ops-pull, hours–days; no SLA promised).
      const lifecycle = {
        created_at: record.createdAtMs,
        expires_at: record.expiresAtMs,
      };
      if (record.state === "submitted" || record.state === "working") {
        c.header("Retry-After", String(RETRY_AFTER_SEC));
        return c.json(
          { state: record.state, ...lifecycle, retry_after: RETRY_AFTER_SEC },
          202,
        );
      }
      return c.json(
        {
          state: record.state,
          response: record.response,
          ...lifecycle,
          retry_after: null,
        },
        200,
      );
    },
  );

  app.post(
    "/api/requests",
    describeRoute({
      summary: "Submit an async agent request → 202 + Location (D-252)",
      tags: ["Requests"],
      responses: { 200: { description: "QA fast-path hit — instant answer" }, 202: { description: "Accepted — poll Location" }, 400: { description: "Invalid or oversized body" }, 413: { description: "Body over 512KB" }, 429: { description: "Submit rate-limit per agentId|fpHash" } },
    }),
    async (c) => {
      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (contentLength > BODY_MAX) {
        return errorResponse(c, 413, ErrorCodes.PAYLOAD_TOO_LARGE, `body over ${BODY_MAX} bytes`,);
      }
      // Audit H-3: chunked bodies have no length — stream-cap the read.
      const raw = await readBodyCap(c, BODY_MAX);
      if (raw === null) {
        return errorResponse(c, 413, ErrorCodes.PAYLOAD_TOO_LARGE, `body over ${BODY_MAX} bytes`,);
      }
      const intake = parseIntake(raw);
      if (!intake.ok) {
        if (intake.error === "too_large") {
          return errorResponse(c, 413, ErrorCodes.PAYLOAD_TOO_LARGE, `body over ${BODY_MAX} bytes`,);
        }
        if (intake.error === "bad_json") {
          return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "bad json");
        }
        if (intake.error === "field_too_large") {
          const cap = intake.field === "payload" ? PAYLOAD_MAX : META_MAX;
          return errorResponse(c, 400, ErrorCodes.PAYLOAD_TOO_LARGE, `${intake.field} over ${cap} bytes`,);
        }
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "payload required",);
      }
      const { kind, payload, publish_to_qa } = intake.body;
      if (kind != null && hasJsonbUnsafe(kind)) { // re-audit M-8
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "kind unsafe");
      }

      const agentId = agentKeyOf(c);
      const { fpHash, softFpHash, ipFpHash, fingerprint } = buildFingerprint({
        ip: resolveClientIp(c),
        ua: c.req.header("user-agent") ?? null,
        referer: c.req.header("referer") ?? null,
        src: c.req.query("src") ?? null,
        headers: headerSnapshot(c),
        salt: env.fingerprintSalt,
      });
      const rawKey = c.req.header("idempotency-key")?.trim() || null;
      // Audit M-11: bounded, printable-ASCII keys only.
      if (rawKey !== null && !/^[\x20-\x7E]{8,255}$/.test(rawKey)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad idempotency-key",);
      }
      const idempotencyKey = rawKey;

      // 1. QA fast-path (D-252-Q7) — no row created.
      const question = payloadQuestionText(payload);
      if (question) {
        const qHash = questionHashFor(normalizeQuestion(question));
        const pair = await stores.requests.getQaByHash(qHash);
        if (pair) {
          try {
            await stores.requests.upsertQaPair({
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
          // D-256-Q15: honest fast-path provenance — no new row was
          // created; the answer comes from the public corpus.
          return c.json(qaFastPathBody(pair), 200);
        }
      }

      // 2. Idempotent replay — bypasses the submit limit (AAuth §11.8).
      if (idempotencyKey) {
        const existing = await stores.requests.findByIdempotency(
          idempotencyKey,
          fpHash,
        );
        if (existing) {
          // Re-audit M-11: jsonb reorders keys → canonical deep-sort
          // both sides; a janitor-purged payload can't be compared,
          // so key+fpHash match is the replay contract.
          if (
            existing.payload !== null &&
            canonicalJson(existing.payload) !== canonicalJson(payload)
          ) {
            return errorResponse(c, 422, ErrorCodes.INVALID_INPUT, "idempotency-key reused with a different payload",);
          }
          const url = `/api/requests/${existing.id}`;
          c.header("Location", url);
          c.header("Retry-After", String(RETRY_AFTER_SEC));
          return c.json(
            { request_id: existing.id, state: existing.state, poll_url: url, duplicate: true },
            202,
          );
        }
      }

      // 3. Submit rate-limit (D-252-Q6): hard + IP + soft lanes.
      const hit = lanes.check(agentId, fpHash, softFpHash, ipFpHash);
      if (hit) {
        c.header("Retry-After", String(hit.retryAfterSec));
        return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "submit rate-limit exceeded", { retryable: true },);
      }

      // 4. Persist + spam-flag probe (D-252-Q5).
      const recordId = `rq_${crypto.randomUUID().replaceAll("-", "")}`;
      let record;
      try {
        ({ record } = await stores.requests.submit({
          id: recordId,
          state: "submitted",
          kind: kind ?? null,
          payload,
          fingerprint,
          fpHash,
          agentId,
          verified: agentId != null,
          publishToQa: publish_to_qa ?? false,
          idempotencyKey,
          expiresAtMs: now() + env.requestTtlMs,
        }));
      } catch {
        // Audit M-1 + re-audit N-1: store failure post-lane → 503,
        // and refund the consumed slots so the retry is not 429.
        lanes.refund(agentId, fpHash, softFpHash, ipFpHash);
        return errorResponse(c, 503, ErrorCodes.INTERNAL_ERROR, "submit failed, retry later", { retryable: true },);
      }

      if (question) {
        try {
          // Audit M-1: the spam probe is advisory — never 500 a submit.
          const hash = contentHashFor(kind ?? null, question);
          // N-2: bounded probe — unbounded scan = amplifier.
          const recent = await stores.requests.listByState({
            sinceMs:
              now() - (deps.submitWindowMs ?? DEFAULT_SUBMIT_WINDOW_MS),
            limit: 200,
          });
          const isSpam = recent.some(
            (r) =>
              r.id !== record.id &&
              r.fpHash === fpHash &&
              r.kind === (kind ?? null) &&
              r.payload != null &&
              contentHashFor(
                r.kind,
                payloadQuestionText(r.payload) ?? "",
              ) === hash,
          );
          if (isSpam) {
            await stores.requests.setSpamFlag(record.id, true);
          }
        } catch {
          /* advisory only */
        }
      }

      const url = `/api/requests/${record.id}`;
      c.header("Location", url);
      c.header("Retry-After", String(RETRY_AFTER_SEC));
      return c.json(
        { request_id: record.id, state: "submitted", poll_url: url },
        202,
      );
    },
  );

  return app;
}
