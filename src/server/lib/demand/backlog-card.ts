/**
 * EPIC-231 (SLICE-231-8): Backlog.md task card — pure builders.
 * Content comes from the opportunity's frozen metricsSnapshot
 * (AC#4: what's asked, unique actors, level, request examples) —
 * never from live counters, so an exported card cannot drift.
 */

import type {
  DemandClusterRecord,
  DemandOpportunityRecord,
  DemandSignalRecord,
} from "./types";

export interface BacklogCard {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  labels: string[];
}

export const BACKLOG_EXAMPLE_LIMIT = 5;

/**
 * Arc 231 R1 H4: flatten caller-origin text for card embedding —
 * control/format chars become spaces, `<!--` and `-->` markers are
 * stripped (they could prematurely close the card's section
 * comments and inject a fake AC block — reproduced by the audit),
 * whitespace collapses to a single line, and the result is capped
 * codepoint-safe. Verbatim `context` is NEVER exported.
 */
export function sanitizeCardText(raw: string, max = 200): string {
  const flat = raw
    .normalize("NFKC")
    .replace(/\p{Cc}|\p{Cf}/gu, " ")
    .replace(/<!--/g, " ")
    .replace(/-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...flat].slice(0, max).join("");
}

export function buildBacklogCard(
  opportunity: DemandOpportunityRecord,
  cluster: DemandClusterRecord | null,
  signals: DemandSignalRecord[],
): BacklogCard {
  const snap = (opportunity.metricsSnapshot ?? {}) as {
    count?: number;
    uniqueActors?: number;
    level?: string;
    /** Frozen at proposal time (231-11) — preferred over live signals. */
    examples?: string[];
  };
  const asked = sanitizeCardText(
    cluster
      ? `${cluster.clusterKey}${cluster.category ? ` (${[cluster.category, cluster.feature].filter(Boolean).join(" / ")})` : ""}`
      : opportunity.title,
    200,
  );
  // Frozen snapshot examples win (H4 — an exported card must not
  // drift with live newest-5 the attacker controls by posting last);
  // legacy opportunities fall back to sanitized live canonicals.
  const texts = Array.isArray(snap.examples)
    ? snap.examples
    : signals.map((s) => sanitizeCardText(s.normalizedText));
  const examples = texts
    .slice(0, BACKLOG_EXAMPLE_LIMIT)
    .map((t) => `  - «${sanitizeCardText(t)}»`)
    .join("\n");
  const description = [
    `Exported from demand opportunity ${opportunity.id} «→ Backlog task».`,
    ``,
    `**What's asked**: ${asked}`,
    opportunity.hypothesis
      ? `**Hypothesis**: ${sanitizeCardText(opportunity.hypothesis, 2000)}`
      : null,
    opportunity.expectedValue
      ? `**Expected value**: ${sanitizeCardText(opportunity.expectedValue, 500)}`
      : null,
    `**Demand**: ${snap.count ?? "?"} canonical requests, ${snap.uniqueActors ?? "?"} unique actors, level ${snap.level ?? "?"}`,
    ``,
    `**Request examples**:`,
    examples || "  - (no canonical signals retained)",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return {
    title: `DEMAND: ${sanitizeCardText(opportunity.title, 100)}`,
    description,
    acceptanceCriteria: [
      `Implemented: ${asked}`,
      `Demand metrics §17.4 updated (opportunity ${opportunity.id} → SHIPPED)`,
    ],
    labels: ["demand-intelligence", "demand-export"],
  };
}

/** Backlog.md task-file format (frontmatter + section markers). */
export function buildBacklogTaskMarkdown(
  taskId: string,
  card: BacklogCard,
  now: string,
  ordinal: number,
): string {
  const ac = card.acceptanceCriteria
    .map((a, i) => `- [ ] #${i + 1} ${a}`)
    .join("\n");
  const labels = card.labels.map((l) => `  - ${l}`).join("\n");
  return `---
id: ${taskId}
title: '${card.title.replace(/'/g, "''")}'
status: To Do
assignee: []
created_date: '${now.slice(0, 10)} ${now.slice(11, 16)}'
updated_date: '${now.slice(0, 10)} ${now.slice(11, 16)}'
labels:
${labels}
dependencies: []
priority: medium
ordinal: ${ordinal}
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
${card.description}
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
${ac}
<!-- AC:END -->
`;
}
