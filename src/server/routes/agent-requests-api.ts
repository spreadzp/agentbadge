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

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { resolveClientIp } from "../middleware/rate-limit";
import {
  buildFingerprint,
  normalizeQuestion,
  questionHashFor,
} from "../lib/request-inbox/fingerprint";
import {
  contentHashFor,
  payloadQuestionText,
} from "../lib/request-inbox/qa";
import {
  createSubmitLimiter,
  headerSnapshot,
  parseIntake,
  BODY_MAX,
  PAYLOAD_MAX,
  META_MAX,
} from "../lib/request-inbox/intake";
import type { RequestInboxStores } from "../lib/request-inbox/store";
import type { RequestInboxEnvConfig } from "../../config/env/types";

/** Default submit window ~2h (D-252-Q6: ~1 submit per 1–2h per key). */
const DEFAULT_SUBMIT_WINDOW_MS = 2 * 60 * 60_000;
const DEFAULT_SUBMIT_MAX = 1;
/** Poll hint — how often agents should retry the status endpoint. */
const RETRY_AFTER_SEC = 5;

export interface AgentRequestRoutesDeps {
  stores: RequestInboxStores;
  env: RequestInboxEnvConfig;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Submit-rate-limit window (default 2h). */
  submitWindowMs?: number;
  /** Max NEW submits per window per agentId|fpHash (default 1). */
  submitMax?: number;
}

const agentKeyOf = (c: Context): string | null =>
  (c.get("agentId") as string | undefined) ?? null;

export function createAgentRequestRoutes(deps: AgentRequestRoutesDeps): Hono {
  const app = new Hono();
  const { stores, env } = deps;
  const now = deps.now ?? (() => Date.now());
  const limiter = createSubmitLimiter({
    windowMs: deps.submitWindowMs ?? DEFAULT_SUBMIT_WINDOW_MS,
    max: deps.submitMax ?? DEFAULT_SUBMIT_MAX,
    now,
  });

  // QA corpus search — registered BEFORE /:id so "qa" wins the param slot.
  app.get(
    "/api/requests/qa",
    describeRoute({
      summary: "Search the request-inbox QA corpus (D-252-Q7)",
      tags: ["Requests"],
      responses: { 200: { description: "Matching QA pairs" } },
    }),
    async (c) => {
      const q = c.req.query("q")?.trim();
      if (!q) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "q required");
      }
      const pairs = await stores.requests.searchQa(normalizeQuestion(q), 25);
      return c.json({
        results: pairs.map((p) => ({
          id: p.id,
          question: p.question,
          response: p.response,
          uses: p.uses,
        })),
      });
    },
  );

  app.get(
    "/api/requests/:id",
    describeRoute({
      summary: "Poll a request — 202 pending / 200 terminal / 410 expired",
      tags: ["Requests"],
      responses: {
        200: { description: "Terminal state with response" },
        202: { description: "Still submitted/working" },
        404: { description: "Unknown request id" },
        410: { description: "Expired — must not retry" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const { record, expired } = await stores.requests.get(id);
      if (!record) {
        return errorResponse(
          c,
          404,
          ErrorCodes.REQUEST_NOT_FOUND,
          "no such request",
        );
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
      if (record.state === "submitted" || record.state === "working") {
        c.header("Retry-After", String(RETRY_AFTER_SEC));
        return c.json({ state: record.state }, 202);
      }
      return c.json({ state: record.state, response: record.response }, 200);
    },
  );

  app.post(
    "/api/requests",
    describeRoute({
      summary: "Submit an async agent request → 202 + Location (D-252)",
      tags: ["Requests"],
      responses: {
        200: { description: "QA fast-path hit — instant answer" },
        202: { description: "Accepted — poll Location" },
        400: { description: "Invalid or oversized body" },
        413: { description: "Body over 512KB" },
        429: { description: "Submit rate-limit per agentId|fpHash" },
      },
    }),
    async (c) => {
      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (contentLength > BODY_MAX) {
        return errorResponse(
          c,
          413,
          ErrorCodes.PAYLOAD_TOO_LARGE,
          `body over ${BODY_MAX} bytes`,
        );
      }
      const intake = parseIntake(await c.req.text());
      if (!intake.ok) {
        if (intake.error === "too_large") {
          return errorResponse(
            c,
            413,
            ErrorCodes.PAYLOAD_TOO_LARGE,
            `body over ${BODY_MAX} bytes`,
          );
        }
        if (intake.error === "bad_json") {
          return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "bad json");
        }
        if (intake.error === "field_too_large") {
          const cap = intake.field === "payload" ? PAYLOAD_MAX : META_MAX;
          return errorResponse(
            c,
            400,
            ErrorCodes.PAYLOAD_TOO_LARGE,
            `${intake.field} over ${cap} bytes`,
          );
        }
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "payload required",
        );
      }
      const { kind, payload } = intake.body;

      const agentId = agentKeyOf(c);
      const { fpHash, fingerprint } = buildFingerprint({
        ip: resolveClientIp(c),
        ua: c.req.header("user-agent") ?? null,
        referer: c.req.header("referer") ?? null,
        src: c.req.query("src") ?? null,
        headers: headerSnapshot(c),
        salt: env.fingerprintSalt,
      });
      const idempotencyKey =
        c.req.header("idempotency-key")?.trim() || null;

      // ── 1. QA fast-path (D-252-Q7) — no row created. ──
      const question = payloadQuestionText(payload);
      if (question) {
        const qHash = questionHashFor(normalizeQuestion(question));
        const pair = await stores.requests.getQaByHash(qHash);
        if (pair) {
          await stores.requests.upsertQaPair({
            id: pair.id,
            questionHash: pair.questionHash,
            question: pair.question,
            response: pair.response,
            sourceRequestId: pair.sourceRequestId,
            createdAtMs: pair.createdAtMs,
          }); // same questionHash → uses++
          return c.json(
            { state: "completed", response: pair.response, qa: true },
            200,
          );
        }
      }

      // ── 2. Idempotent replay — bypasses the submit limit (AAuth §11.8).
      if (idempotencyKey) {
        const existing = await stores.requests.findByIdempotency(
          idempotencyKey,
          fpHash,
        );
        if (existing) {
          const url = `/api/requests/${existing.id}`;
          c.header("Location", url);
          c.header("Retry-After", String(RETRY_AFTER_SEC));
          return c.json(
            {
              request_id: existing.id,
              state: existing.state,
              poll_url: url,
              duplicate: true,
            },
            202,
          );
        }
      }

      // ── 3. Submit rate-limit (D-252-Q6): agentId|fpHash, ~1/2h. ──
      const limited = limiter.check(`${agentId ?? fpHash}`);
      if (limited) {
        c.header("Retry-After", String(limited.retryAfterSec));
        return errorResponse(
          c,
          429,
          ErrorCodes.RATE_LIMITED,
          "submit rate-limit exceeded",
          { retryable: true },
        );
      }

      // ── 4. Persist + spam-flag probe (D-252-Q5). ──
      const recordId = `rq_${crypto.randomUUID().replaceAll("-", "")}`;
      const { record } = await stores.requests.submit({
        id: recordId,
        state: "submitted",
        kind: kind ?? null,
        payload,
        fingerprint,
        fpHash,
        agentId,
        verified: agentId != null,
        idempotencyKey,
        expiresAtMs: now() + env.requestTtlMs,
      });

      if (question) {
        const hash = contentHashFor(kind ?? null, question);
        const recent = await stores.requests.listByState({
          sinceMs: now() - (deps.submitWindowMs ?? DEFAULT_SUBMIT_WINDOW_MS),
        });
        const isSpam = recent.some(
          (r) =>
            r.id !== record.id &&
            r.fpHash === fpHash &&
            r.kind === (kind ?? null) &&
            r.payload != null &&
            contentHashFor(r.kind, payloadQuestionText(r.payload) ?? "") ===
              hash,
        );
        if (isSpam) {
          await stores.requests.setSpamFlag(record.id, true);
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
