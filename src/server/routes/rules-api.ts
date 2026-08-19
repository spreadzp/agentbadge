import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { RULE_DESCRIPTIONS, CATEGORY_DESCRIPTIONS } from "../../agent-readiness/rule-descriptions";
import { categoryEnum } from "../../agent-readiness/shared.schema";
import { getRuleDescription } from "../../views/rule-detail-page";

export const rulesApiRoutes = new Hono();

rulesApiRoutes.get(
  "/rules",
  describeRoute({
    tags: ["API"],
    summary: "List all rule descriptions",
    description: "Returns all 76 agent readiness rule descriptions with category metadata.",
    responses: {
      200: { description: "JSON with total, categories, and rules array" },
    },
  }),
  (c) => {
    return c.json({
      total: RULE_DESCRIPTIONS.length,
      categories: categoryEnum.options.map((cat) => ({
        id: cat,
        ...CATEGORY_DESCRIPTIONS[cat],
        rule_count: RULE_DESCRIPTIONS.filter((r) => r.category === cat).length,
      })),
      rules: RULE_DESCRIPTIONS,
    });
  },
);

rulesApiRoutes.get(
  "/rules/:id",
  describeRoute({
    tags: ["API"],
    summary: "Get a single rule description",
    description: "Returns the description for a specific rule by ID (e.g. AB-001).",
    responses: {
      200: { description: "Rule description object" },
      404: { description: "Rule not found" },
    },
  }),
  (c) => {
    const ruleId = c.req.param("id");
    const rule = getRuleDescription(ruleId);
    if (!rule) {
      return c.json({ error: "Rule not found", rule_id: ruleId }, 404);
    }
    return c.json(rule);
  },
);
