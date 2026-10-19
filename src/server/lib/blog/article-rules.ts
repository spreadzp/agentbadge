/**
 * SLICE-201-6: blog article → agent-readiness rules linkage.
 * `rules: string[]` on BlogArticle lists AB-* ids the article covers.
 * This module validates ids against the registry and resolves them to
 * descriptions for the article page block.
 */
import {
  RULE_DESCRIPTIONS,
  type RuleDescription,
} from "../../../agent-readiness/rule-descriptions";
import type { BlogArticle } from "../blog-data";

const BY_ID = new Map(RULE_DESCRIPTIONS.map((r) => [r.rule_id, r]));

export interface InvalidRuleRef {
  slug: string;
  ruleId: string;
}

/** Rule ids referenced by articles but missing from the registry. */
export function findInvalidRuleIds(articles: BlogArticle[]): InvalidRuleRef[] {
  const out: InvalidRuleRef[] = [];
  for (const a of articles) {
    for (const id of a.rules ?? []) {
      if (!BY_ID.has(id)) out.push({ slug: a.slug, ruleId: id });
    }
  }
  return out;
}

/** Resolve an article's rules[] to registry descriptions (unknown ids skipped). */
export function articleRuleDescriptions(
  article: Pick<BlogArticle, "rules">,
): RuleDescription[] {
  return (article.rules ?? [])
    .map((id) => BY_ID.get(id))
    .filter((r): r is RuleDescription => !!r);
}
