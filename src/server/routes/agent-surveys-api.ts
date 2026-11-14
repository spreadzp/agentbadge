/**
 * EPIC-252 (SLICE-252-4, D-252-Q6): survey → rating lane —
 *   GET  /api/surveys/open           — public active survey list
 *   POST /api/surveys/:id/answer     — verified → ReputationWrite
 *                                      (namespace `surveys`, metric
 *                                      answers_rated_count, status
 *                                      "skipped" = milestone counter,
 *                                      no mint) ; anon → unrated
 *   POST /api/ops/surveys            — adminAuth create (ops-only v1)
 *
 * Dedupe: (surveyId,agentId) verified / (surveyId,fpHash) anon → 409.
 * Answer rate-limit same lane model (agentId|fpHash). Untrusted input:
 * credited on answer fact, quality is an ops-pipeline concern later.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { adminAuth } from "../middleware/adminAuth";
import { resolveClientIp } from "../middleware/rate-limit";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { buildFingerprint } from "../lib/request-inbox/fingerprint";
import { createSubmitLanes, headerSnapshot } from "../lib/request-inbox/intake";
import type { RequestInboxStores } from "../lib/request-inbox/store";
import type { RequestInboxEnvConfig } from "../../config/env/request-inbox-types";
import type { ReputationWriteRecord } from "../lib/board/types";
import { newReputationId } from "../lib/board/types";
import { boardStore } from "../lib/board/store";

export interface AgentSurveyRoutesDeps {
  stores: RequestInboxStores;
  env: Pick<RequestInboxEnvConfig, "fingerprintSalt">;
  now?: () => number;
  /** Milestone counter writer — default shared board ledger. */
  writeReputation?: (rec: ReputationWriteRecord) => void;
  answerWindowMs?: number;
  answerMax?: number;
  /** Soft-lane cap for anonymous answers (IP-rotation brake,
   *  SLICE-252-7). Default: max(answerMax*8, 8). */
  answerSoftMax?: number;
}

const ANSWERS_MAX = 64 * 1024;

const answerSchema = z.object({ answers: z.unknown() });
const surveyCreateSchema = z.object({
  title: z.string().min(1).max(200),
  questions: z.unknown(),
  closesAtMs: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

const agentKeyOf = (c: { get: (k: string) => unknown }): string | null =>
  (c.get("agentId") as string | undefined) ?? null;

const fpFor = (
  c: Parameters<typeof resolveClientIp>[0],
  salt: string,
) =>
  buildFingerprint({
    ip: resolveClientIp(c),
    ua: c.req.header("user-agent") ?? null,
    referer: c.req.header("referer") ?? null,
    src: c.req.query("src") ?? null,
    headers: headerSnapshot(c),
    salt,
  });

export function createAgentSurveyRoutes(
  deps: AgentSurveyRoutesDeps,
): Hono {
  const app = new Hono();
  const { stores, env } = deps;
  const now = deps.now ?? (() => Date.now());
  const writeReputation =
    deps.writeReputation ??
    ((r: ReputationWriteRecord) => {
      boardStore().putReputation(r);
    });
  const lanes = createSubmitLanes({
    windowMs: deps.answerWindowMs ?? 7_200_000,
    max: deps.answerMax ?? 20,
    softMax: deps.answerSoftMax,
    now,
  });

  app.get(
    "/api/surveys/open",
    describeRoute({
      summary: "List open agent surveys (public)",
      tags: ["Surveys"],
      responses: { 200: { description: "Active surveys" } },
    }),
    async (c) => {
      const items = await stores.surveys.listOpenSurveys(now(), 50);
      return c.json({
        items: items.map((s) => ({
          id: s.id,
          title: s.title,
          questions: s.questions,
          closesAtMs: s.closesAtMs,
        })),
      });
    },
  );

  app.post(
    "/api/ops/surveys",
    adminAuth,
    describeRoute({
      summary: "Create an agent survey (ops-only, D-252-Q6)",
      tags: ["Ops"],
      responses: {
        201: { description: "Survey created" },
        400: { description: "Invalid body" },
        401: { description: "Admin key required" },
      },
    }),
    async (c) => {
      const parsed = surveyCreateSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "title + questions required",
        );
      }
      const survey = await stores.surveys.putSurvey({
        id: `sv_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        title: parsed.data.title,
        questions: parsed.data.questions ?? [],
        active: parsed.data.active ?? true,
        closesAtMs: parsed.data.closesAtMs ?? null,
        createdAtMs: now(),
      });
      return c.json(survey, 201);
    },
  );

  app.post(
    "/api/surveys/:id/answer",
    describeRoute({
      summary: "Submit a survey answer — verified answers are rated",
      tags: ["Surveys"],
      responses: {
        202: { description: "Answer accepted (rated:true only verified)" },
        400: { description: "Invalid body" },
        404: { description: "Unknown survey" },
        409: { description: "Already answered (dedupe)" },
        410: { description: "Survey closed" },
        429: { description: "Answer rate-limit" },
      },
    }),
    async (c) => {
      const survey = await stores.surveys.getSurvey(c.req.param("id"));
      if (!survey) {
        return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no survey");
      }
      if (
        !survey.active ||
        (survey.closesAtMs !== null && survey.closesAtMs <= now())
      ) {
        return errorResponse(c, 410, ErrorCodes.REQUEST_EXPIRED, "closed");
      }
      const parsed = answerSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (
        !parsed.success ||
        parsed.data.answers === undefined ||
        Buffer.byteLength(JSON.stringify(parsed.data.answers), "utf8") >
        ANSWERS_MAX
      ) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "answers required");
      }
      const agentId = agentKeyOf(c);
      const { fpHash, softFpHash } = fpFor(c, env.fingerprintSalt);
      // Dedupe first — a repeat must never consume the rate-limit slot.
      const dup = agentId
        ? await stores.surveys.findAnswerByAgent(survey.id, agentId)
        : await stores.surveys.findAnswerByFp(survey.id, fpHash);
      if (dup) {
        return errorResponse(
          c,
          409,
          ErrorCodes.INVALID_STATE,
          "already answered",
        );
      }
      // Same dual-lane model as request intake: anonymous IPs face
      // the IP-less softFpHash lane too, so IP rotation can't mint
      // fresh answer lanes (SLICE-252-7 landmine).
      const hit = lanes.check(agentId, fpHash, softFpHash);
      if (hit) {
        return errorResponse(
          c,
          429,
          ErrorCodes.RATE_LIMITED,
          `retry in ${hit.retryAfterSec}s`,
        );
      }
      const answer = await stores.surveys.putAnswer({
        id: `ans_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        surveyId: survey.id,
        agentId,
        fpHash,
        answers: parsed.data.answers,
        rated: false,
        createdAtMs: now(),
      });
      if (agentId) {
        writeReputation({
          id: newReputationId(),
          sourceType: "surveys",
          sourceId: `${survey.id}:${agentId}`,
          jobAttempt: 1,
          passportId: agentId,
          agentId,
          score: 1,
          status: "skipped", // milestone counter only — D-252-Q6, no mint
          attempts: 0,
          payload: {
            metric: "answers_rated_count",
            milestone: true,
            surveyId: survey.id,
            answerId: answer.id,
          },
        });
        await stores.surveys.markRated(answer.id);
      }
      return c.json({ accepted: true, answer_id: answer.id, rated: agentId != null }, 202);
    },
  );

  return app;
}
