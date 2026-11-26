/**
 * EPIC-232 (SLICE-232-4, spec E3): `knowledge_search` scenario —
 * LLM-assisted search over the 229 knowledge store for operators.
 *
 * Flow per job: resolve the request-inbox subject → FTS/MEMORY
 * candidate fetch via `searchKnowledgeItems` (read-only — D-228-7:
 * zero writes, zero auto-attach) → ONE provider call that
 * reformulates the ask into a clean query AND ranks the fetched
 * candidates. AiRun output:
 *   {query, matchedEntryIds[], relevanceScores, confidence}.
 *
 * Soft-dep seam (AC#2): the store is injected — `knowledge: null`
 * means the 229 surface is not wired in this deployment; the runner
 * returns `notAvailable` and the worker records an honest
 * `seam_unavailable` skip without spending a provider call.
 */

import type { KnowledgeStore } from "../knowledge/store";
import { searchKnowledgeItems } from "../knowledge/search";
import type { KnowledgeSearchHit } from "../knowledge/types";
import type { RequestInboxStores } from "../request-inbox/store";

import { loadSubject, promptFor, userBlock } from "./intake-runners";
import { registerScenarioRunner } from "./scenarios";
import type { AiScenarioRunner } from "./scenarios";

export const KNOWLEDGE_SEARCH_SCENARIO = "knowledge_search";

const KNOWLEDGE_SEARCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "reformulated search query expressing the ask",
    },
    matchedEntryIds: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
      description: "candidate itemIds relevant to the request",
    },
    relevanceScores: {
      type: "object",
      additionalProperties: { type: "number", minimum: 0, maximum: 1 },
      description: "itemId → relevance 0..1 for each matched id",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["query", "matchedEntryIds", "relevanceScores", "confidence"],
  additionalProperties: false,
};

const FALLBACK_KNOWLEDGE_SEARCH =
  "You are an operator-side search assistant. Given an agent request " +
  "and candidate knowledge entries: (1) write a clean reformulated " +
  "search query; (2) pick the relevant candidate ids; (3) score each " +
  "0..1. Reply JSON only: {query, matchedEntryIds[], " +
  "relevanceScores{<id>:0..1}, confidence 0..1}.";

const MAX_CANDIDATES = 8;

function candidateBlock(candidates: KnowledgeSearchHit[]): string {
  if (candidates.length === 0) return "candidates: (none)";
  const rows = candidates
    .map(
      (c) =>
        `- id=${c.itemId} | ${c.title} | kind=${c.kind}` +
        (c.snippet ? ` | ${c.snippet.slice(0, 160)}` : ""),
    )
    .join("\n");
  return `candidates:\n${rows}`;
}

/** Bind inbox + knowledge stores into the knowledge_search runner. */
export function registerKnowledgeSearchRunner(opts: {
  stores: RequestInboxStores;
  /** 229 seam — null → NOT_AVAILABLE degrade (AC#2). */
  knowledge: KnowledgeStore | null;
}): void {
  const { stores, knowledge } = opts;

  const runner: AiScenarioRunner = async ({ job }) => {
    if (!knowledge) {
      return { notAvailable: "knowledge_store" };
    }
    const subject = await loadSubject(stores, job.subjectId);
    // Read-only candidate fetch — raw request text as the FTS query;
    // the LLM's reformulated query is an output artifact for the
    // operator (what the AI understood the ask to be), not a second
    // retrieval round-trip — one provider call per run.
    const { items } = await searchKnowledgeItems(knowledge, subject.text, {
      limit: MAX_CANDIDATES,
    });
    return promptFor(
      KNOWLEDGE_SEARCH_SCENARIO,
      FALLBACK_KNOWLEDGE_SEARCH,
      `${userBlock(subject)}\n\n${candidateBlock(items)}`,
      KNOWLEDGE_SEARCH_SCHEMA,
      400,
    );
  };

  registerScenarioRunner(KNOWLEDGE_SEARCH_SCENARIO, runner);
}
