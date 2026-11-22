import type {
  KnowledgeCapabilityUpsert,
  KnowledgeRelationInsert,
  KnowledgeSearchOpts,
} from "./store";
import type {
  KnowledgeCapabilityRecord,
  KnowledgeRelationRecord,
  KnowledgeSearchHit,
} from "./types";
import {
  linkKey,
  memorySearchScore,
  memorySnippet,
  nowIso,
  type MemoryKnowledgeData,
} from "./memory-data";

/**
 * EPIC-229 (SLICE-229-1): memory-side taxonomy — capabilities, m:n
 * links, typed relations, version evidence, the FTS-parity search
 * seam. Mirrors the DB-side KnowledgeTaxonomyRepository split.
 * Honest-signal shapes identical to the Postgres adapter.
 */
export class MemoryKnowledgeTaxonomy {
  constructor(protected readonly data: MemoryKnowledgeData) {}

  // ─── capabilities ──

  async upsertCapability(input: KnowledgeCapabilityUpsert) {
    const existing = [...this.data.capabilities.values()].find(
      (c) => c.name === input.name,
    );
    if (existing) {
      // Arc R3 M-10: provenance is symmetric — writes apply only
      // when source matches (SEEDED can't colonize MANUAL either).
      if (existing.source === input.source) {
        const changed =
          existing.kind !== input.kind ||
          existing.description !== (input.description ?? null) ||
          existing.verified !== input.verified;
        if (changed) {
          existing.kind = input.kind;
          existing.description = input.description ?? null;
          existing.verified = input.verified;
          existing.updatedAt = nowIso();
        }
      }
      return { row: existing, created: false };
    }
    const now = nowIso();
    const row: KnowledgeCapabilityRecord = {
      id: input.id,
      name: input.name,
      kind: input.kind,
      description: input.description ?? null,
      source: input.source,
      verified: input.verified,
      createdAt: now,
      updatedAt: now,
    };
    this.data.capabilities.set(row.id, row);
    return { row, created: true };
  }

  async getCapability(id: string) {
    return this.data.capabilities.get(id) ?? null;
  }

  async getCapabilityByName(name: string) {
    for (const c of this.data.capabilities.values()) {
      if (c.name === name) return c;
    }
    return null;
  }

  async listCapabilities(opts?: {
    verified?: boolean;
    kind?: string;
    limit?: number;
  }) {
    let rows = [...this.data.capabilities.values()];
    if (opts?.verified !== undefined) {
      rows = rows.filter((r) => r.verified === opts.verified);
    }
    if (opts?.kind !== undefined) {
      rows = rows.filter((r) => r.kind === opts.kind);
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows.slice(0, opts?.limit ?? 1000);
  }

  async linkCapability(itemId: string, capabilityId: string) {
    const key = linkKey(itemId, capabilityId);
    const created = !this.data.links.has(key);
    this.data.links.add(key);
    return { created };
  }

  async unlinkCapability(itemId: string, capabilityId: string) {
    return { removed: this.data.links.delete(linkKey(itemId, capabilityId)) };
  }

  async capabilitiesForItem(itemId: string) {
    const ids = [...this.data.links]
      .filter((k) => k.startsWith(`${itemId}::`))
      .map((k) => k.split("::")[1]);
    return [...this.data.capabilities.values()]
      .filter((c) => ids.includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async itemsForCapability(name: string) {
    const cap = await this.getCapabilityByName(name);
    if (!cap) return [];
    return [...this.data.links]
      .filter((k) => k.endsWith(`::${cap.id}`))
      .map((k) => k.split("::")[0])
      .sort();
  }

  async addRelation(input: KnowledgeRelationInsert) {
    for (const r of this.data.relations.values()) {
      if (
        r.fromItemId === input.fromItemId &&
        r.toItemId === input.toItemId &&
        r.type === input.type
      ) {
        return { row: null, created: false };
      }
    }
    // SUPERSEDES cycle check inside the store — BFS to→from
    // reachability, same bounds as the PG CTE (128/2000).
    if (input.type === "SUPERSEDES") {
      if (
        !this.data.items.has(input.fromItemId) ||
        !this.data.items.has(input.toItemId)
      ) {
        return { row: null, created: false, reason: "items_missing" as const };
      }
      const adj = new Map<string, string[]>();
      for (const r of this.data.relations.values()) {
        if (r.type !== "SUPERSEDES") continue;
        adj.set(r.fromItemId, [...(adj.get(r.fromItemId) ?? []), r.toItemId]);
      }
      // Arc R4: mirror the PG CTE exactly — the queue seeds with
      // toItemId's direct neighbors (depth 1), `reached` counts
      // DISTINCT visited nodes excluding the start (the old queue
      // counted the start, so the 2000 bound tripped one early),
      // and a proven path is `supersedes_cycle` while a bound hit
      // is `supersedes_bound`.
      const queue: [string, number][] = (adj.get(input.toItemId) ?? []).map(
        (n) => [n, 1],
      );
      const reached = new Set<string>();
      let reason: "supersedes_cycle" | "supersedes_bound" | null = null;
      for (let qi = 0; qi < queue.length && reason === null; qi++) {
        const [node, depth] = queue[qi]!;
        if (node === input.fromItemId) {
          reason = "supersedes_cycle";
        } else if (depth >= 128) {
          // Hitting the bound may truncate the traversal — refuse
          // rather than pass "no path" (PG maxDepth>=128 same).
          reason = "supersedes_bound";
        } else if (!reached.has(node)) {
          reached.add(node);
          // PG refuses when DISTINCT reached nodes >= 2000 — the
          // 2000th node already trips the bound, no 2001st needed.
          if (reached.size >= 2000) {
            reason = "supersedes_bound";
            break;
          }
          for (const nxt of adj.get(node) ?? []) queue.push([nxt, depth + 1]);
        }
      }
      if (reason !== null) {
        return { row: null, created: false, reason };
      }
    }
    const row: KnowledgeRelationRecord = {
      id: input.id,
      fromItemId: input.fromItemId,
      toItemId: input.toItemId,
      type: input.type,
      createdBy: input.createdBy,
      createdAt: nowIso(),
    };
    this.data.relations.set(row.id, row);
    return { row, created: true };
  }

  async removeRelation(id: string) {
    const row = this.data.relations.get(id);
    const removed = this.data.relations.delete(id);
    return removed ? { removed: true, row } : { removed: false };
  }

  async relationsFor(itemId: string) {
    const outgoing: KnowledgeRelationRecord[] = [];
    const incoming: KnowledgeRelationRecord[] = [];
    for (const r of this.data.relations.values()) {
      if (r.fromItemId === itemId) outgoing.push(r);
      if (r.toItemId === itemId) incoming.push(r);
    }
    const byEdge = (
      a: KnowledgeRelationRecord,
      b: KnowledgeRelationRecord,
    ) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
    return {
      outgoing: outgoing.sort(byEdge),
      incoming: incoming.sort(byEdge),
    };
  }

  // ─── search seam (D-229-4) ──
  async searchItems(opts: KnowledgeSearchOpts) {
    const status = opts.status ?? "PUBLISHED";
    const capItemIds =
      opts.capabilityRef != null
        ? await this.itemsForCapability(opts.capabilityRef)
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
    // Arc R1 M5: rank ties → slug asc, same contract as the FTS path.
    out.sort((a, b) => b.rank - a.rank || a.slug.localeCompare(b.slug));
    return out.slice(0, opts.limit ?? 20);
  }
}
