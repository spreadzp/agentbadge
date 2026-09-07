import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { resolver } from "hono-openapi";
import { getErrorCatalog } from "../lib/error-catalog";

export const metaRoutes = new Hono();

const errorEntrySchema = z.object({
  code: z.string().describe("Stable error code identifier"),
  http_status: z.number().int().describe("HTTP status code returned with this error"),
  agent_impact: z.string().describe("Human-readable description of what this error means for an AI agent"),
  hint_template: z.string().describe("Suggested fix or recovery action for the agent"),
  affected_routes: z.array(z.string()).describe("Route patterns where this error can occur"),
  recovery_action: z.enum([
    "retry_immediately",
    "change_request",
    "await_human",
    "wait_and_retry",
    "choose_alternative",
    "not_authorized",
    "no_action",
    "escalate",
  ]).describe("Recommended recovery action for an AI agent"),
});

metaRoutes.get(
  "/api/meta/errors",
  describeRoute({
    tags: ["Meta"],
    summary: "Error catalog — machine-readable error codes for AI agents",
    description:
      "Returns a catalog of all error codes used by the AgentBadge API, with recovery actions and hints. AI agents can use this to programmatically handle errors.",
    responses: {
      200: {
        description: "Error catalog",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                total_count: z.number().int(),
                count: z.number().int(),
                errors: z.array(errorEntrySchema),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(getErrorCatalog(), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);
