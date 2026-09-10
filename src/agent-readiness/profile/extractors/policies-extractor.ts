import type { Assertion } from "../../rule-engine/assertion-builder";
import type { PoliciesSection } from "../profile-schema";
import { SECTION_CATEGORY_MAP } from "../section-map";
import { computeSectionMeta, filterByCategories } from "./section-meta-helper";

/**
 * SLICE-101-5: Policies Extractor.
 *
 * Pure function: extracts policies section from assertions.
 * Filters by SECTION_CATEGORY_MAP.policies categories (agent_policy, agents_txt, accessibility, actionability).
 * Returns undefined if zero applicable assertions.
 */

export function extractPolicies(assertions: Assertion[]): PoliciesSection | undefined {
  const applicable = filterByCategories(assertions, SECTION_CATEGORY_MAP.policies);

  if (applicable.length === 0) return undefined;

  let llmPolicy: string | undefined;
  let agentsTxt = false;
  let robotsTxt = false;
  let crawling: string | undefined;

  for (const a of applicable) {
    if (a.status !== "VERIFIED" && a.status !== "INFERRED") continue;

    const url = a.source_url ?? "";
    const aName = a.name.toLowerCase();

    // agents.txt — VERIFIED assertion for agents.txt rule
    if (a.category === "agents_txt" || aName.includes("agents.txt") || url.includes("agents.txt")) {
      agentsTxt = true;
    }

    // robots.txt — VERIFIED assertion for robots.txt rule
    if (aName.includes("robots.txt") || url.includes("robots.txt")) {
      robotsTxt = true;
    }

    for (const e of a.evidence) {
      const detail = (e as { semantic_detail?: string }).semantic_detail ?? "";
      const eUrl = (e as { url?: string }).url ?? "";

      // LLM policy from llm-policy.json
      if (eUrl.includes("llm-policy") || eUrl.includes("llm_policy") || detail.includes("llm_policy") || detail.includes("llm-policy")) {
        if (detail) {
          try {
            const parsed = JSON.parse(detail);
            if (parsed.summary) {
              llmPolicy = parsed.summary;
            } else if (parsed.allowance) {
              llmPolicy = parsed.allowance;
            } else if (parsed.pre_training || parsed.fine_tuning || parsed.rag) {
              const parts: string[] = [];
              if (parsed.pre_training) parts.push(`pre-training: ${parsed.pre_training}`);
              if (parsed.fine_tuning) parts.push(`fine-tuning: ${parsed.fine_tuning}`);
              if (parsed.rag) parts.push(`RAG: ${parsed.rag}`);
              if (parsed.agentic) parts.push(`agentic: ${parsed.agentic}`);
              llmPolicy = parts.join(", ");
            }
          } catch {
            // Not JSON — use raw detail if short
            if (detail.length < 200 && !llmPolicy) {
              llmPolicy = detail;
            }
          }
        }
      }

      // Robots.txt crawling analysis
      if (e.type === "robots") {
        const robots = e as { disallowed_paths?: string[]; allows_all?: boolean };
        if (robots.allows_all === true || (robots.disallowed_paths?.length === 0)) {
          crawling = "allowed";
        } else if (robots.disallowed_paths && robots.disallowed_paths.length > 0) {
          // Check if disallowing everything
          if (robots.disallowed_paths.includes("/") || robots.disallowed_paths.includes("/*")) {
            crawling = "denied";
          } else {
            crawling = "restricted";
          }
        }
      }

      // Agents.txt from evidence URL
      if (eUrl.includes("agents.txt")) {
        agentsTxt = true;
      }

      // Robots.txt from evidence URL
      if (eUrl.includes("robots.txt")) {
        robotsTxt = true;
      }
    }
  }

  const meta = computeSectionMeta(applicable);

  return {
    data: {
      llm_policy: llmPolicy,
      agents_txt: agentsTxt,
      robots_txt: robotsTxt,
      crawling,
    },
    ...meta,
  };
}
