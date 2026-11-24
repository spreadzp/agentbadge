/**
 * Arc R3 test helper — approval transitions (VERIFIED/PUBLISHED)
 * now REQUIRE stale-page preconditions minted at "page render":
 * expectedVersionId always, expectedEvidence fingerprint for the
 * VERIFIED gate. Tests call this exactly like the SSR form does —
 * read the CURRENT item state, pin it, transition.
 */

import {
  addEvidence,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  evidenceFingerprint,
  recordGap,
  transitionKnowledgeItem,
} from "../../src/server/lib/knowledge";
import type { KnowledgeStore } from "../../src/server/lib/knowledge";
import type { OperatorStore } from "../../src/server/lib/operators";
import { generateReportId } from "../../src/agent-readiness/integrity/ulid";
import { createMemoryOperatorStore } from "./operators";

export async function approveTransition(
  store: KnowledgeStore,
  itemId: string,
  to: string,
  actor: string,
  reason: string | null = null,
) {
  const item = await store.getItem(itemId);
  const evidence = item?.latestVersionId
    ? await store.listEvidence(item.latestVersionId)
    : [];
  return transitionKnowledgeItem(store, itemId, to, actor, reason, {
    expectedVersionId: item?.latestVersionId ?? undefined,
    expectedEvidence: evidenceFingerprint(evidence),
  });
}

// ─── 264-10/11: gap seeding helpers shared by the ownership and
//     audit suites (fresh memory stores per test) ──

export async function mkGapStore() {
  const store = createMemoryKnowledgeStores();
  const operators = createMemoryOperatorStore();
  return { store, operators };
}

export async function mkGap(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
) {
  const r = await recordGap(store, {
    query: "How does escrow settlement work?",
    source: "COMPOSER_REFUSAL",
  });
  if (!r.ok || !r.gap) throw new Error("gap seed failed");
  return r.gap;
}

export async function mkServiceOp(
  operators: OperatorStore,
  type = "service",
) {
  const op = await operators.createOperator({
    id: `op_${generateReportId()}`,
    displayName: `${type} principal`,
    principalType: type,
    capabilities: ["read"],
  });
  if (!op.ok) throw new Error(`seed failed: ${op.reason}`);
  return op.operator.id;
}

/** RESOLVED needs a PUBLISHED linked item — create + evidence +
 *  the PENDING→VERIFIED→PUBLISHED walk (same recipe as
 *  knowledge-gaps.test.ts). */
export async function mkPublishedItem(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
  slug: string,
) {
  const c = await createKnowledgeItem(
    store, { kind: "GUIDE", slug, title: "t", body: "b" }, "ops",
  );
  if (!c.ok) throw new Error(`create failed: ${c.error}`);
  const ev = await addEvidence(store, c.version.id, {
    type: "INTERNAL_DOC", uri: `internal://runbook/${slug}`, addedBy: "ops",
  });
  if (!ev.ok) throw new Error("evidence failed");
  for (const [to, actor] of [
    ["PENDING", "ops"], ["VERIFIED", "ops_review"], ["PUBLISHED", "ops"],
  ] as const) {
    const t = await approveTransition(store, c.item.id, to, actor);
    if (!t.ok) throw new Error(`transition ${to} failed`);
  }
  return c.item.id;
}
