import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { scanDomain } from "../../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../agent-readiness/rule-engine/rule-engine";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";
import type { AgentReadinessRule } from "../../agent-readiness/rule.schema";

export const scanRuleRoutes = new Hono();

/**
 * Map a target path substring to a resource key (mirrors rule-engine's targetToSnapshotKey).
 */
const TARGET_TO_RESOURCE: Record<string, string> = {
  "robots": "robots",
  "sitemap": "sitemap",
  "agent-guide": "guide",
  "openapi": "openapi",
  "mcp": "mcp",
  "llms-full": "llms_full",
  "llms": "llms",
  "skill": "skill",
  "agents.txt": "agents_txt",
  "webmcp": "webmcp",
  "x402": "x402",
  "content_negotiation": "content_negotiation",
  "rss": "rss_feed",
  "feed": "rss_feed",
  "did.json": "identity",
  "webfinger": "identity",
  "oauth": "bot_auth",
  "oauth-authorization-server": "identity",
  "http-message-signatures": "bot_auth",
  "infrastructure": "infrastructure",
  "agent-card": "a2a",
  "homepage": "homepage_meta",
  "favicon": "favicon",
  "og-image": "content_negotiation",
  "nonexistent": "content_negotiation",
  "pricing": "pricing",
  "passport": "l402",
};

/**
 * Determine which resources to fetch for a single rule.
 * Returns only the minimal set needed by that rule.
 */
function getResourcesForRule(rule: AgentReadinessRule): string[] {
  // If rule has explicit sources, use them
  if (rule.check.sources && rule.check.sources.length > 0) {
    return rule.check.sources;
  }

  // For http_fetch rules, map target to resource
  if (rule.check.target) {
    const target = rule.check.target;
    for (const [substr, key] of Object.entries(TARGET_TO_RESOURCE)) {
      if (target.includes(substr)) return [key];
    }
  }

  // cross_evidence or other rules without explicit sources — fetch all
  return [];
}

scanRuleRoutes.post(
  "/scan-rule",
  describeRoute({
    tags: ["API"],
    summary: "Scan a single rule against a URL",
    description: "Scans the given URL and returns the result for a single rule by ID (e.g. AB-001). Only fetches the resource needed for that rule.",
    responses: {
      200: { description: "Rule scan result" },
      400: { description: "Invalid URL or missing rule_id" },
      404: { description: "Rule not found in results" },
    },
  }),
  async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { url, rule_id } = body;
    if (!url || typeof url !== "string") {
      return c.json({ error: "Missing or invalid 'url' field" }, 400);
    }
    if (!rule_id || typeof rule_id !== "string") {
      return c.json({ error: "Missing or invalid 'rule_id' field" }, 400);
    }

    try {
      new URL(url);
    } catch {
      return c.json({ error: `Invalid URL: ${url}` }, 400);
    }

    const rule = (AGENT_READINESS_RULESET.rules as AgentReadinessRule[]).find(
      (r) => r.rule_id === rule_id,
    );
    if (!rule) {
      return c.json({ error: `Unknown rule_id: ${rule_id}` }, 400);
    }

    try {
      // Only fetch resources needed for this specific rule
      const neededResources = getResourcesForRule(rule);
      const scanOpts = neededResources.length > 0
        ? { noCache: true, resources: neededResources }
        : { noCache: true };

      const sourceState = await scanDomain(url, scanOpts);
      const ruleEngineResult = RuleEngine.run(sourceState);
      const assertion = (ruleEngineResult.assertions as any[]).find(
        (a) => a.rule_id === rule_id,
      );

      if (!assertion) {
        return c.json({ error: `Rule ${rule_id} not found in scan results` }, 404);
      }

      return c.json({
        rule_id: assertion.rule_id,
        rule_name: assertion.rule_name ?? assertion.name,
        category: assertion.category,
        status: assertion.status,
        hint: assertion.hint ?? assertion.fix_hint ?? null,
        evidence: assertion.evidence ?? null,
        scanned_url: url,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Scan failed: ${msg}` }, 500);
    }
  },
);
