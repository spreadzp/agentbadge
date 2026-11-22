import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import {
  KNOWLEDGE_RELATION_TYPES,
  type KnowledgeItemRecord,
  type KnowledgeRelationRecord,
} from "./types";

/**
 * EPIC-229 (SLICE-229-6, D-229-8): typed relation edges.
 * Item-scope (never version-scope) — edges survive re-versioning.
 * Invariants enforced here, not at the route layer:
 *   - type ∈ vocab
 *   - no self-loops
 *   - no SUPERSEDES cycles (A→B rejects if B→A exists)
 *   - both endpoints exist
 * Store dedups by compound unique → created:false is an honest
 * no-op, not an error.
 */

export interface KnowledgeRelationEdge {
  type: string;
  relationId: string;
  item: KnowledgeItemRecord;
}

export interface KnowledgeRelations {
  outgoing: KnowledgeRelationEdge[];
  incoming: KnowledgeRelationEdge[];
}

/** Arc R1 M1 → R2 M-7: the SUPERSEDES cycle check moved INSIDE the
 *  store — the lib-level DFS was decoyable past its depth cap and
 *  raced concurrent inserts; the PG adapter now locks both endpoint
 *  items and runs a bounded recursive CTE under the lock. */

export async function addRelation(
  store: KnowledgeStore,
  input: {
    fromItemId: string;
    toItemId: string;
    type: string;
    actorRef: string;
  },
): Promise<
  KnowledgeResult<{ relation: KnowledgeRelationRecord; created: boolean }>
> {
  if (!KNOWLEDGE_RELATION_TYPES.includes(input.type as never)) {
    return { ok: false, error: "bad_relation_type", field: "type" };
  }
  if (input.fromItemId === input.toItemId) {
    return { ok: false, error: "self_loop", field: "toItemId" };
  }
  const [from, to] = await Promise.all([
    store.getItem(input.fromItemId),
    store.getItem(input.toItemId),
  ]);
  if (!from || !to) {
    return { ok: false, error: "missing_item", field: "toItemId" };
  }
  const res = await store.addRelation({
    id: `krel_${randomUUID()}`,
    fromItemId: input.fromItemId,
    toItemId: input.toItemId,
    type: input.type,
    createdBy: input.actorRef,
  });
  if (res.reason === "supersedes_cycle") {
    return { ok: false, error: "supersedes_cycle", field: "type" };
  }
  if (res.reason === "items_missing") {
    return { ok: false, error: "missing_item", field: "toItemId" };
  }
  if (!res.row) {
    // Dedup hit — resolve the existing edge for an honest echo.
    const existing = (await store.relationsFor(input.fromItemId))
      .outgoing.find(
        (r) => r.toItemId === input.toItemId && r.type === input.type,
      );
    if (!existing) return { ok: false, error: "store_conflict" };
    return { ok: true, relation: existing, created: false };
  }
  if (res.created) {
    emitKnowledgeEvent(
      "knowledge.relation_added",
      {
        relationId: res.row.id,
        toItemId: res.row.toItemId,
        type: res.row.type,
        actorRef: input.actorRef,
      },
      res.row.fromItemId,
    );
  }
  return { ok: true, relation: res.row, created: res.created };
}

export async function removeRelation(
  store: KnowledgeStore,
  id: string,
  actor?: string,
): Promise<KnowledgeResult<{ removed: boolean }>> {
  const res = await store.removeRelation(id);
  // Arc R1 H4 + R2 M-11: edge deletes are audited too, with the
  // acting operator on the payload — an unattributed removal is
  // an audit hole.
  if (res.removed && res.row) {
    emitKnowledgeEvent(
      "knowledge.relation_removed",
      {
        relationId: res.row.id,
        toItemId: res.row.toItemId,
        type: res.row.type,
        actor: actor ?? null,
      },
      res.row.fromItemId,
    );
  }
  return { ok: true, removed: res.removed };
}

/** Edges with endpoint items resolved — RELATED_TO reads both ways. */
export async function relationsFor(
  store: KnowledgeStore,
  itemId: string,
): Promise<KnowledgeRelations> {
  const rows = await store.relationsFor(itemId);
  const ids = new Set<string>();
  for (const r of [...rows.outgoing, ...rows.incoming]) {
    ids.add(r.fromItemId === itemId ? r.toItemId : r.fromItemId);
  }
  const items = new Map<string, KnowledgeItemRecord>();
  await Promise.all(
    [...ids].map(async (id) => {
      const it = await store.getItem(id);
      if (it) items.set(id, it);
    }),
  );
  const edge = (r: KnowledgeRelationRecord, peerId: string) => ({
    type: r.type,
    relationId: r.id,
    item: items.get(peerId) as KnowledgeItemRecord,
  });
  return {
    outgoing: rows.outgoing
      .filter((r) => items.has(r.toItemId))
      .map((r) => edge(r, r.toItemId)),
    incoming: rows.incoming
      .filter((r) => items.has(r.fromItemId))
      .map((r) => edge(r, r.fromItemId)),
  };
}

/** The item that supersedes this one (UI hint: offer to withdraw). */
export async function supersededBy(
  store: KnowledgeStore,
  itemId: string,
): Promise<KnowledgeItemRecord | null> {
  const rows = await store.relationsFor(itemId);
  const edge = rows.incoming.find((r) => r.type === "SUPERSEDES");
  return edge ? store.getItem(edge.fromItemId) : null;
}
