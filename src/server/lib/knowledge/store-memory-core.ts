import type {
  KnowledgeItemInsert,
  KnowledgeStatusEventInsert,
  KnowledgeVersionInsert,
} from "./store";
import type {
  KnowledgeItemRecord,
  KnowledgeVersionRecord,
} from "./types";
import { nowIso, type MemoryKnowledgeData } from "./memory-data";

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
    rows.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
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

  /** Arc R1 H5: same contract as the DB adapter — assert required
   *  status (DRAFT), compute seq = max+1, copy evidence refs from
   *  the prior version when asked. Single-threaded maps make the
   *  composite trivially atomic. */
  async addVersion(
    version: Omit<KnowledgeVersionInsert, "seq"> & {
      copyEvidenceFromLatest?: boolean;
      expectedSeq?: number;
    },
    opts?: { requireStatus?: string },
  ) {
    const item = this.data.items.get(version.itemId);
    if (!item) return { ok: false as const, reason: "missing" as const };
    const requireStatus = opts?.requireStatus ?? "DRAFT";
    if (item.status !== requireStatus) {
      return { ok: false as const, reason: "not_draft" as const };
    }
    let seq = 1;
    for (const v of this.data.versions.values()) {
      if (v.itemId === version.itemId && v.seq >= seq) seq = v.seq + 1;
    }
    // Arc R2 M-8: lost-update precondition — the editor must have
    // read the same latest seq the store sees now.
    if (version.expectedSeq !== undefined && version.expectedSeq !== seq - 1) {
      return { ok: false as const, reason: "stale_seq" as const };
    }
    const v: KnowledgeVersionRecord = {
      id: version.id,
      itemId: version.itemId,
      seq,
      title: version.title,
      body: version.body,
      summary: version.summary ?? null,
      restoredFromVersionId: version.restoredFromVersionId ?? null,
      createdBy: version.createdBy,
      createdAt: nowIso(),
    };
    this.data.versions.set(v.id, v);
    if (version.copyEvidenceFromLatest) {
      for (const e of this.data.evidence.values()) {
        if (e.versionId !== item.latestVersionId) continue;
        const copy: typeof e = {
          ...e,
          id: `kev_${crypto.randomUUID()}`,
          versionId: v.id,
        };
        this.data.evidence.set(copy.id, copy);
      }
    }
    item.latestVersionId = v.id;
    item.updatedAt = v.createdAt;
    return { ok: true as const, version: v };
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
}
