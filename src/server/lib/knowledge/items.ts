import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import {
  ensureUniqueSlug,
  isValidKnowledgeSlug,
  slugifyTitle,
} from "./slug";
import type { KnowledgeStore } from "./store";
import {
  createKnowledgeItemInputSchema,
  updateKnowledgeDraftInputSchema,
  type CreateKnowledgeItemInput,
  type KnowledgeItemRecord,
  type KnowledgeVersionRecord,
  type UpdateKnowledgeDraftInput,
} from "./types";

/**
 * EPIC-229 (SLICE-229-2, D-229-1/D-229-2): item CRUD + versioning.
 *
 * Invariants enforced here:
 * - Items are born DRAFT with version seq=1 and a create status
 *   event — one atomic store composite.
 * - Edits NEVER mutate existing versions: updateDraft appends
 *   seq+1 and moves only `latestVersionId`. `publishedVersionId`
 *   is untouched — only the workflow layer (229-3) may set it.
 * - Honest results: validation/business failures return
 *   `{ ok: false, error }`, never throw (228 lib convention).
 */

export type KnowledgeResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; field?: string };

/** Arc R1 M12: unique-index races (concurrent same-slug creates)
 *  surface as honest slug_taken instead of a driver 500. */
const isUniqueLike = (err: unknown) =>
  /unique|duplicate/i.test(err instanceof Error ? err.message : String(err));

export async function createKnowledgeItem(
  store: KnowledgeStore,
  raw: CreateKnowledgeItemInput,
  actorRef: string,
): Promise<
  KnowledgeResult<{
    item: KnowledgeItemRecord;
    version: KnowledgeVersionRecord;
  }>
> {
  const parsed = createKnowledgeItemInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "invalid input",
      field: issue?.path.join("."),
    };
  }
  const input = parsed.data;

  let slug: string;
  if (input.slug !== undefined) {
    if (!isValidKnowledgeSlug(input.slug)) {
      return { ok: false, error: "invalid_slug", field: "slug" };
    }
    if ((await store.getItemBySlug(input.slug)) !== null) {
      return { ok: false, error: "slug_taken", field: "slug" };
    }
    slug = input.slug;
  } else {
    const base =
      slugifyTitle(input.title) ?? `item-${randomUUID().slice(0, 8)}`;
    slug = await ensureUniqueSlug(store, base);
  }

  const itemId = `ki_${randomUUID()}`;
  const created = await store
    .createItemWithVersion(
    {
      id: itemId,
      slug,
      kind: input.kind,
      status: "DRAFT",
      createdBy: actorRef,
    },
    {
      id: `kv_${randomUUID()}`,
      itemId,
      seq: 1,
      title: input.title,
      body: input.body,
      summary: input.summary ?? null,
      createdBy: actorRef,
    },
    {
      id: `kse_${randomUUID()}`,
      itemId,
      from: null,
      to: "DRAFT",
      actor: actorRef,
      reason: "created",
    },
    ).catch((err: unknown) => {
      if (isUniqueLike(err)) {
        return null;
      }
      throw err;
    });
  if (!created) return { ok: false, error: "slug_taken", field: "slug" };
  const { item, version } = created;
  emitKnowledgeEvent(
    "knowledge.created",
    { slug: item.slug, kind: item.kind, actor: actorRef },
    item.id,
  );
  return { ok: true, item, version };
}

export async function updateKnowledgeDraft(
  store: KnowledgeStore,
  itemId: string,
  raw: UpdateKnowledgeDraftInput,
  actorRef: string,
): Promise<
  KnowledgeResult<{
    item: KnowledgeItemRecord;
    version: KnowledgeVersionRecord;
  }>
> {
  const parsed = updateKnowledgeDraftInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "invalid input",
      field: issue?.path.join("."),
    };
  }
  const input = parsed.data;

  const item = await store.getItem(itemId);
  if (!item) return { ok: false, error: "not_found" };
  if (item.status !== "DRAFT") {
    return { ok: false, error: "not_editable_in_status" };
  }

  // Merge onto the latest version — unspecified fields inherit.
  const prev = item.latestVersionId
    ? await store.getVersion(item.latestVersionId)
    : null;
  const merged = {
    title: input.title ?? prev?.title ?? "",
    body: input.body ?? prev?.body ?? "",
    summary:
      input.summary === undefined
        ? (prev?.summary ?? null)
        : (input.summary ?? null),
  };
  // No-op saves append no version (and emit no event) — an identical
  // merge is reported honestly instead of inflating the audit trail.
  if (
    prev &&
    merged.title === prev.title &&
    merged.body === prev.body &&
    merged.summary === prev.summary
  ) {
    return { ok: true, item, version: prev };
  }
  // Arc R1 H5+H4 / R2 M-8: the store locks the item row, re-asserts
  // DRAFT, computes seq under the lock and copies evidence from the
  // latest version AS LOCKED — expectedSeq is the caller's
  // lost-update precondition (a stale editor can't silently merge
  // over a version they never saw).
  const added = await store.addVersion({
    id: `kv_${randomUUID()}`,
    itemId,
    title: merged.title,
    body: merged.body,
    summary: merged.summary,
    copyEvidenceFromLatest: true,
    expectedSeq: input.expectedSeq ?? prev?.seq,
    createdBy: actorRef,
  });
  if (!added.ok) {
    return {
      ok: false,
      error:
        added.reason === "not_draft"
          ? "not_editable_in_status"
          : added.reason === "stale_seq"
            ? "stale_seq"
            : "not_found",
    };
  }
  const version = added.version;
  emitKnowledgeEvent(
    "knowledge.version_created",
    { slug: item.slug, seq: version.seq, actor: actorRef },
    item.id,
  );
  const reloaded = await store.getItem(itemId);
  return { ok: true, item: reloaded ?? item, version };
}
