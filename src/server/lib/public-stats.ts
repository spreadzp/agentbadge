/**
 * PUBLIC_STATS — single source of truth for public-facing numbers (D-218-1).
 *
 * Every marketing/discovery surface (meta descriptions, FAQ, landing
 * sections, agent-knowledge markdown, comparison pages, llms*.txt,
 * content-negotiation bodies) MUST derive counts from here instead of
 * hardcoding literals — the ruleset, categories, pillars and tool
 * registries drift over time and literals went stale (147 rules claimed
 * as 72/82/122/130 depending on the page).
 *
 * Sources:
 *   rules      — agent-readiness rule descriptions (canonical ruleset)
 *   categories — CATEGORY_DESCRIPTIONS keys
 *   pillars    — PILLAR_DESCRIPTIONS keys
 *   mcpTools   — live MCP tool registry (count reflects registered tools
 *                at call time; 0 before registerDefaultMcpTools runs)
 *   webmcpTools— WebMCP browser-tool registry (@agentbadge/webmcp)
 *   lastUpdated— build date injected at deploy
 */

import {
  RULE_DESCRIPTIONS,
  CATEGORY_DESCRIPTIONS,
  PILLAR_DESCRIPTIONS,
} from "../../agent-readiness/rule-descriptions";
import { listTools } from "@agentbadge/mcp";
import { allTools } from "@agentbadge/webmcp";
import { BUILD_DATE } from "./build-info";

export const PUBLIC_STATS = {
  rules: RULE_DESCRIPTIONS.length,
  categories: Object.keys(CATEGORY_DESCRIPTIONS).length,
  pillars: Object.keys(PILLAR_DESCRIPTIONS).length,
  get mcpTools(): number {
    return listTools().length;
  },
  webmcpTools: allTools.length,
  lastUpdated: BUILD_DATE,
} as const;

/**
 * Template vars for `{{…}}` placeholders in public content. Merged into
 * the chain-template map so every existing applyChainTemplates call site
 * picks them up without plumbing changes.
 */
export function publicStatsVars(): Record<string, string> {
  return {
    RULE_COUNT: String(PUBLIC_STATS.rules),
    CATEGORY_COUNT: String(PUBLIC_STATS.categories),
    PILLAR_COUNT: String(PUBLIC_STATS.pillars),
    MCP_TOOL_COUNT: String(PUBLIC_STATS.mcpTools),
    WEBMCP_TOOL_COUNT: String(PUBLIC_STATS.webmcpTools),
    LAST_UPDATED: PUBLIC_STATS.lastUpdated,
  };
}

/**
 * Replace `{{RULE_COUNT}}`, `{{CATEGORY_COUNT}}`, `{{PILLAR_COUNT}}`,
 * `{{MCP_TOOL_COUNT}}`, `{{WEBMCP_TOOL_COUNT}}`, `{{LAST_UPDATED}}`
 * placeholders with live values. Unknown placeholders pass through.
 * (Generalizes injectDynamicFacts previously local to authority.ts.)
 */
export function injectDynamicFacts(body: string): string {
  const replacements = publicStatsVars();
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    replacements[key] ?? match,
  );
}
