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

export function buildBacklogCard(
  opportunity: DemandOpportunityRecord,
  cluster: DemandClusterRecord | null,
  signals: DemandSignalRecord[],
): BacklogCard {
  const snap = (opportunity.metricsSnapshot ?? {}) as {
    count?: number;
    uniqueActors?: number;
    level?: string;
  };
  const asked = cluster
    ? `${cluster.clusterKey}${cluster.category ? ` (${[cluster.category, cluster.feature].filter(Boolean).join(" / ")})` : ""}`
    : opportunity.title;
  const examples = signals
    .slice(0, BACKLOG_EXAMPLE_LIMIT)
    .map((s) => `  - «${(s.context ?? s.normalizedText).slice(0, 200)}»`)
    .join("\n");
  const description = [
    `Exported from demand opportunity ${opportunity.id} «→ Backlog task».`,
    ``,
    `**What's asked**: ${asked}`,
    opportunity.hypothesis ? `**Hypothesis**: ${opportunity.hypothesis}` : null,
    opportunity.expectedValue
      ? `**Expected value**: ${opportunity.expectedValue}`
      : null,
    `**Demand**: ${snap.count ?? "?"} canonical requests, ${snap.uniqueActors ?? "?"} unique actors, level ${snap.level ?? "?"}`,
    ``,
    `**Request examples**:`,
    examples || "  - (no canonical signals retained)",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return {
    title: `DEMAND: ${opportunity.title}`.slice(0, 120),
    description,
    acceptanceCriteria: [
      `Реализовано: ${asked}`,
      `Demand-метрики §17.4 обновлены (opportunity ${opportunity.id} → SHIPPED)`,
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
