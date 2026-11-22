/**
 * Arc R3 test helper — approval transitions (VERIFIED/PUBLISHED)
 * now REQUIRE stale-page preconditions minted at "page render":
 * expectedVersionId always, expectedEvidence fingerprint for the
 * VERIFIED gate. Tests call this exactly like the SSR form does —
 * read the CURRENT item state, pin it, transition.
 */

import {
  evidenceFingerprint,
  transitionKnowledgeItem,
} from "../../src/server/lib/knowledge";
import type { KnowledgeStore } from "../../src/server/lib/knowledge";

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
