import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { adminAuth } from "../../middleware/adminAuth";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import type { RequestInboxStores } from "../../lib/request-inbox/store";

/**
 * EPIC-252 (ops): survey-answers pull for operators.
 * Split from agent-surveys-api.ts / agent-requests-ops-api.ts —
 * both sit at the 300-line lint cap.
 */

export interface AgentSurveyOpsRoutesDeps {
  stores: RequestInboxStores;
}

export function createAgentSurveyOpsRoutes(
  deps: AgentSurveyOpsRoutesDeps,
): Hono {
  const app = new Hono();
  const { stores } = deps;

  app.get(
    "/api/ops/surveys/:id/answers",
    adminAuth,
    describeRoute({
      summary: "Ops pull - survey answers with voter fingerprints (hashes only)",
      tags: ["Ops"],
      responses: {
        200: { description: "Answer list for the survey" },
        401: { description: "Admin key required" },
        404: { description: "Unknown survey" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const survey = await stores.surveys.getSurvey(id);
      if (!survey) {
        return errorResponse(
          c,
          404,
          ErrorCodes.REQUEST_NOT_FOUND,
          "no survey",
        );
      }
      const answers = await stores.surveys.listAnswers(id, 500);
      return c.json({
        survey: {
          id: survey.id,
          title: survey.title,
          active: survey.active,
          closesAtMs: survey.closesAtMs,
        },
        items: answers.map((a) => ({
          id: a.id,
          agentId: a.agentId,
          fpHash: a.fpHash,
          answers: a.answers,
          rated: a.rated,
          createdAtMs: a.createdAtMs,
        })),
      });
    },
  );

  return app;
}
