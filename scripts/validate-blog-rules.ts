#!/usr/bin/env bun
/**
 * SLICE-201-6: CI validator — every rules[] id in blog articles must
 * exist in the agent-readiness rule registry. Run: bun scripts/validate-blog-rules.ts
 */
import { BLOG_ARTICLES } from "../src/server/lib/blog-data";
import { findInvalidRuleIds } from "../src/server/lib/blog/article-rules";

const invalid = findInvalidRuleIds(BLOG_ARTICLES);
if (invalid.length > 0) {
  console.error("✖ Invalid rule ids in blog articles:");
  for (const { slug, ruleId } of invalid) {
    console.error(`  ${slug}: ${ruleId}`);
  }
  process.exit(1);
}
const total = BLOG_ARTICLES.reduce((n, a) => n + (a.rules?.length ?? 0), 0);
console.log(
  `✔ blog rules ok — ${total} refs across ${BLOG_ARTICLES.length} articles`,
);
