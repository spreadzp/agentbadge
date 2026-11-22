import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import type { KnowledgeVersionRecord } from "./types";

/**
 * EPIC-229 (SLICE-229-2, D-229-2): version reads + restore.
 * Versions are append-only — restore copies content into a NEW
 * version; the source is never mutated.
 */

export async function listKnowledgeVersions(
  store: KnowledgeStore,
  itemId: string,
): Promise<KnowledgeVersionRecord[]> {
  return store.listVersions(itemId);
}

export async function getKnowledgeVersion(
  store: KnowledgeStore,
  itemId: string,
  seq: number,
): Promise<KnowledgeVersionRecord | null> {
  return store.getVersionBySeq(itemId, seq);
}

/**
 * Copy an old version's content into a new latest version with
 * `restoredFromVersionId` set. Requires the item to be DRAFT —
 * restoring under review/published would silently change what an
 * operator is reviewing (PENDING/VERIFIED must first return to
 * DRAFT, PUBLISHED keeps serving the pinned version regardless).
 */
export async function restoreKnowledgeVersion(
  store: KnowledgeStore,
  itemId: string,
  seq: number,
  actorRef: string,
): Promise<KnowledgeResult<{ version: KnowledgeVersionRecord }>> {
  const item = await store.getItem(itemId);
  if (!item) return { ok: false, error: "not_found" };
  if (item.status !== "DRAFT") {
    return { ok: false, error: "not_editable_in_status" };
  }
  const source = await store.getVersionBySeq(itemId, seq);
  if (!source) return { ok: false, error: "version_not_found" };

  // Arc R1 H5+H4 / R2 M-8: seq under the store's item lock +
  // evidence copied from the latest version AS LOCKED (the one
  // under review), never a caller-stale source id. expectedSeq
  // refuses a restore racing another writer's append.
  const latest = item.latestVersionId
    ? await store.getVersion(item.latestVersionId)
    : null;
  const added = await store.addVersion({
    id: `kv_${randomUUID()}`,
    itemId,
    title: source.title,
    body: source.body,
    summary: source.summary,
    restoredFromVersionId: source.id,
    copyEvidenceFromLatest: true,
    expectedSeq: latest?.seq,
    createdBy: actorRef,
  });
  if (!added.ok) {
    return {
      ok: false,
      error:
        added.reason === "not_draft" ? "not_editable_in_status" : "not_found",
    };
  }
  const version = added.version;
  emitKnowledgeEvent(
    "knowledge.version_created",
    { slug: item.slug, seq: version.seq, restoredFrom: seq, actor: actorRef },
    item.id,
  );
  return { ok: true, version };
}
