import type {
  KnowledgeItemInsert,
  KnowledgeSearchOpts,
  KnowledgeStatusEventInsert,
  KnowledgeTransitionInput,
  KnowledgeTransitionResult,
  KnowledgeVersionInsert,
} from "./store";
import type {
  KnowledgeItemRecord,
  KnowledgeSearchHit,
  KnowledgeStatusEventRecord,
  KnowledgeVersionRecord,
} from "./types";
import {
  memorySearchScore,
  memorySnippet,
  nowIso,
  type MemoryKnowledgeData,
} from "./memory-data";

/**
 * EPIC-229 (SLICE-229-1): memory-side core aggregate — items,
 * append-only versions, status events, CAS transitions, search seam.
 * Mirrors the DB-side KnowledgeRepository split (229-1 file-size cap
 * forced the taxonomy half into store-memory-taxonomy.ts).
 * Composites are atomic trivially (single-threaded maps).
 */
export class MemoryKnowledgeCore {
  constructor(protected readonly data: MemoryKnowledgeData) {}

  // ─── items ──

  async getItem(id: string): Promise<KnowledgeItemRecord | null> {
    return this.data.items.get(id) ?? null;
  }

  async getItemBySlug(slug: string): Promise<KnowledgeItemRecord | null> {
    for (const it of this.data.items.values()) {
      if (it.slug === slug) return it;
    }
    return null;
  }

  async listItems(opts?: { status?: string; kind?: string; limit?: number }) {
    let rows = [...this.data.items.values()];
    if (opts?.status !== undefined) {
      rows = rows.filter((r) => r.status === opts.status);
    }
    if (opts?.kind !== undefined) {
      rows = rows.filter((r) => r.kind === opts.kind);
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows.slice(0, opts?.limit ?? 500);
  }

  /** Item + version seq=1 + create-event + latest pointer — atomic. */
  async createItemWithVersion(
    item: KnowledgeItemInsert,
    version: KnowledgeVersionInsert,
    event: KnowledgeStatusEventInsert,
  ) {
    const now = nowIso();
    const it: KnowledgeItemRecord = {
      id: item.id,
      slug: item.slug,
      kind: item.kind,
      status: item.status ?? "DRAFT",
      latestVersionId: version.id,
      publishedVersionId: null,
      createdBy: item.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const v: KnowledgeVersionRecord = {
      id: version.id,
      itemId: version.itemId,
      seq: version.seq,
      title: version.title,
      body: version.body,
      summary: version.summary ?? null,
      restoredFromVersionId: version.restoredFromVersionId ?? null,
      createdBy: version.createdBy,
      createdAt: now,
    };
    this.data.items.set(it.id, it);
    this.data.versions.set(v.id, v);
    this.data.events.set(event.id, {
      id: event.id,
      itemId: event.itemId,
      from: event.from,
      to: event.to,
      actor: event.actor,
      reason: event.reason ?? null,
      createdAt: now,
    });
    return { item: it, version: v };
  }

  /** Append version + bump latestVersionId — atomic. */
  async addVersion(version: KnowledgeVersionInsert) {
    const dup = [...this.data.versions.values()].some(
      (v) => v.itemId === version.itemId && v.seq === version.seq,
    );
    if (dup) {
      throw new Error(
        `knowledge version unique violation: (${version.itemId}, ${version.seq})`,
      );
    }
    const v: KnowledgeVersionRecord = {
      id: version.id,
      itemId: version.itemId,
      seq: version.seq,
      title: version.title,
      body: version.body,
      summary: version.summary ?? null,
      restoredFromVersionId: version.restoredFromVersionId ?? null,
      createdBy: version.createdBy,
      createdAt: nowIso(),
    };
    this.data.versions.set(v.id, v);
    const item = this.data.items.get(version.itemId);
    if (item) {
      item.latestVersionId = v.id;
      item.updatedAt = v.createdAt;
    }
    return v;
  }

  // ─── versions ──

  async getVersion(id: string) {
    return this.data.versions.get(id) ?? null;
  }

  async getVersionBySeq(itemId: string, seq: number) {
    for (const v of this.data.versions.values()) {
      if (v.itemId === itemId && v.seq === seq) return v;
    }
    return null;
  }

  async listVersions(itemId: string) {
    return [...this.data.versions.values()]
      .filter((v) => v.itemId === itemId)
      .sort((a, b) => b.seq - a.seq);
  }

  // ─── status machine ──

  async transitionItem(
    id: string,
    input: KnowledgeTransitionInput,
  ): Promise<KnowledgeTransitionResult> {
    const item = this.data.items.get(id);
    if (!item) {
      return {
        item: null,
        event: null,
        transitioned: false,
        reason: "missing",
      };
    }
    if (item.status !== input.from) {
      return {
        item,
        event: null,
        transitioned: false,
        reason: "status_mismatch",
      };
    }
    item.status = input.to;
    if (input.publish === true) item.publishedVersionId = item.latestVersionId;
    if (input.unpublish === true) item.publishedVersionId = null;
    item.updatedAt = nowIso();
    const event: KnowledgeStatusEventRecord = {
      id: input.eventId ?? `kse_${crypto.randomUUID()}`,
      itemId: id,
      from: input.from,
      to: input.to,
      actor: input.actor,
      reason: input.reason ?? null,
      createdAt: item.updatedAt,
    };
    this.data.events.set(event.id, event);
    return { item, event, transitioned: true };
  }

  async listStatusEvents(itemId: string) {
    return [...this.data.events.values()]
      .filter((e) => e.itemId === itemId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ─── search seam (D-229-4) ──

  async searchItems(opts: KnowledgeSearchOpts) {
    const status = opts.status ?? "PUBLISHED";
    const capItemIds =
      opts.capabilityRef != null
        ? this.itemsForCapability(opts.capabilityRef)
        : null;
    const out: KnowledgeSearchHit[] = [];
    for (const item of this.data.items.values()) {
      if (item.status !== status) continue;
      if (opts.kind != null && item.kind !== opts.kind) continue;
      if (capItemIds != null && !capItemIds.includes(item.id)) continue;
      if (!item.publishedVersionId) continue;
      const v = this.data.versions.get(item.publishedVersionId);
      if (!v) continue;
      const rank = memorySearchScore(opts.query, v.title, v.body);
      if (rank <= 0) continue;
      out.push({
        itemId: item.id,
        slug: item.slug,
        kind: item.kind,
        versionId: v.id,
        title: v.title,
        summary: v.summary,
        snippet: memorySnippet(opts.query, v.title, v.body),
        rank,
      });
    }
    out.sort((a, b) => b.rank - a.rank);
    return out.slice(0, opts.limit ?? 20);
  }

  /** Taxonomy-side seam the core needs for capabilityRef search. */
  private itemsForCapability(name: string): string[] {
    const cap = [...this.data.capabilities.values()].find(
      (c) => c.name === name,
    );
    if (!cap) return [];
    return [...this.data.links]
      .filter((k) => k.endsWith(`::${cap.id}`))
      .map((k) => k.split("::")[0]);
  }
}
