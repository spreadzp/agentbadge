/**
 * EPIC-232 (SLICE-232-5, spec E4 + D-232-3): `answer_draft` — an LLM
 * draft reply for an `agent_request` subject.
 *
 * The draft is advisory text only: the prompt forbids commitments,
 * verdicts, or platform promises (§16.5), and there is NO code path
 * from AiRun to any outbound channel — the operator's respond form
 * may prefill the textarea with draftText, but sending is always a
 * human submit.
 *
 * E3 link (AC#4): when the subject's latest successful
 * `knowledge_search` run exists, its matchedEntryIds hydrate via the
 * knowledge store and land in the prompt as cited context; absent
 * runs or an absent knowledge seam just produce a hit-free draft —
 * drafting does not degrade on knowledge, only on the inbox seam.
 */

import type { KnowledgeStore } from "../knowledge/store";
import type { RequestInboxStores } from "../request-inbox/store";

import {
  loadSubject,
  promptFor,
  sanitizeInline,
  sanitizeUntrusted,
  UNTRUSTED_RULE,
  userBlock,
} from "./intake-runners";
import { registerScenarioRunner } from "./scenarios";
import type { AiScenarioRunner } from "./scenarios";

export const ANSWER_DRAFT_SCENARIO = "answer_draft";
const KNOWLEDGE_SEARCH = "knowledge_search";
const MAX_HITS = 5;

const ANSWER_DRAFT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    draftText: { type: "string" },
    usedKnowledgeIds: {
      type: "array",
      items: { type: "string" },
      maxItems: 10,
    },
    tone: { type: "string", enum: ["brief", "detailed", "clarifying"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["draftText", "usedKnowledgeIds", "tone", "confidence"],
  additionalProperties: false,
};

const FALLBACK_DRAFT =
  "Draft an advisory reply to the agent request. Return {draftText, " +
  "usedKnowledgeIds[] (ids actually cited), tone ∈ brief|detailed|" +
  "clarifying, confidence 0..1}. Constraints: propose, never commit; " +
  "no verdicts, no promises on behalf of the platform; ask for " +
  "clarification when the request is ambiguous. JSON only. " +
  UNTRUSTED_RULE;

interface KnowledgeHit {
  id: string;
  title: string;
  body: string;
}

/** Hydrate E3 output — matched ids from the latest NON-SHADOW
 *  successful knowledge_search run — into prompt-ready excerpts.
 *  232-12 H-1: a shadow run is invisible to operators; letting its
 *  picks shape a visible draft leaks the shadow output by
 *  composition, so shadow runs are skipped entirely.
 *  232-12 H-3: only PUBLISHED versions hydrate — unpublished
 *  latestVersionId content must not reach a request-facing draft. */
async function hydrateHits(
  runner: { store: AiScenarioRunnerStore; subjectId: string },
  knowledge: KnowledgeStore | null,
): Promise<KnowledgeHit[]> {
  if (!knowledge) return [];
  const runs = await runner.store.listRuns({
    subjectType: "agent_request",
    subjectId: runner.subjectId,
    scenario: KNOWLEDGE_SEARCH,
    limit: 10,
  });
  const run = runs.find(
    (r) => r.modeAtTime !== "shadow" && r.status === "success" && r.output,
  );
  if (!run) return [];
  const ids = (run.output as { matchedEntryIds?: unknown }).matchedEntryIds;
  if (!Array.isArray(ids)) return [];
  const hits: KnowledgeHit[] = [];
  for (const id of ids.slice(0, MAX_HITS)) {
    if (typeof id !== "string") continue;
    const item = await knowledge.getItem(id);
    const version = item?.publishedVersionId
      ? await knowledge.getVersion(item.publishedVersionId)
      : null;
    if (item && version) {
      hits.push({ id: item.id, title: version.title, body: version.body });
    }
  }
  return hits;
}

type AiScenarioRunnerStore = Parameters<AiScenarioRunner>[0]["store"];

/** Bind the inbox + knowledge seams into the answer_draft runner. */
export function registerAnswerDraftRunner(opts: {
  /** null → agent_request subjects degrade to NOT_AVAILABLE. */
  inbox: RequestInboxStores | null;
  /** null → drafts run without knowledge context (no degrade — the
   *  request itself is always available material). */
  knowledge: KnowledgeStore | null;
}): void {
  const { inbox, knowledge } = opts;

  const runner: AiScenarioRunner = async ({ job, store }) => {
    if (job.subjectType !== "agent_request") {
      throw new Error(
        `unsupported_subject: answer_draft takes agent_request, ` +
          `got ${job.subjectType}`,
      );
    }
    if (!inbox) return { notAvailable: "request_inbox" };
    const subject = await loadSubject(inbox, job.subjectId);
    const hits = await hydrateHits(
      { store, subjectId: job.subjectId },
      knowledge,
    );
    const ctx = hits
      .map(
        (h) =>
          `- [${sanitizeInline(h.id, 120)}] ${sanitizeInline(h.title, 160)}\n` +
          `  ${sanitizeUntrusted(h.body, 400)}`,
      )
      .join("\n");
    const user =
      userBlock(subject) +
      (ctx
        ? `\n\nknowledge base excerpts (cite via usedKnowledgeIds):\n${ctx}`
        : "\n\n(no knowledge base excerpts matched this request)");
    const prompt = promptFor(
      ANSWER_DRAFT_SCENARIO,
      FALLBACK_DRAFT,
      user,
      ANSWER_DRAFT_SCHEMA,
      800,
    );
    // H-3: usedKnowledgeIds may only cite excerpts the model saw.
    const hydrated = new Set(hits.map((h) => h.id));
    prompt.validateOutput = (output) => {
      const ids = (output as { usedKnowledgeIds?: unknown })
        ?.usedKnowledgeIds;
      for (const id of Array.isArray(ids) ? ids : []) {
        if (typeof id !== "string" || !hydrated.has(id)) {
          return `uncited_knowledge_id: ${String(id).slice(0, 120)}`;
        }
      }
      return null;
    };
    return prompt;
  };

  registerScenarioRunner(ANSWER_DRAFT_SCENARIO, runner);
}
