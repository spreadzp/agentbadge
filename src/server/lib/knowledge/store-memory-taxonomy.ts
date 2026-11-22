import type {
  KnowledgeCapabilityUpsert,
  KnowledgeEvidenceInsert,
  KnowledgeRelationInsert,
  KnowledgeSearchOpts,
} from "./store";
import type {
  KnowledgeCapabilityRecord,
  KnowledgeEvidenceRecord,
  KnowledgeRelationRecord,
  KnowledgeSearchHit,
} from "./types";
import {
  KNOWLEDGE_EVIDENCE_CAP,
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
      // Arc R1 M3: MANUAL must not downgrade SEEDED — a SEEDED
      // refresh still updates code-derived fields.
      const seededProtected =
        existing.source === "SEEDED" && input.source !== "SEEDED";
      if (!seededProtected) {
        existing.kind = input.kind;
        existing.description = input.description ?? null;
        existing.verified = input.verified;
        if (input.source === "SEEDED") existing.source = "SEEDED";
        existing.updatedAt = nowIso();
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
    // Arc R2 M-7: SUPERSEDES cycle check inside the store — BFS
    // to→from reachability, same bounds as the PG CTE (128/2000).
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
      const queue: [string, number][] = [[input.toItemId, 0]];
      const seen = new Set<string>();
      let overflow = false;
      for (let qi = 0; qi < queue.length && !overflow; qi++) {
        const [node, depth] = queue[qi]!;
        if (node === input.fromItemId || seen.size >= 2000) {
          overflow = true;
        } else if (!seen.has(node) && depth < 128) {
          seen.add(node);
          for (const nxt of adj.get(node) ?? []) queue.push([nxt, depth + 1]);
        }
      }
      if (overflow) {
        return { row: null, created: false, reason: "supersedes_cycle" as const };
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

  async addEvidence(input: KnowledgeEvidenceInsert) {
    const version = this.data.versions.get(input.versionId);
    if (!version) {
      return { ok: false as const, reason: "missing_version" as const };
    }
    // Arc R1 H4 / R2 H-2: evidence freezes at PENDING — DRAFT +
    // LATEST version only; verifier reviews the submitted set.
    const item = this.data.items.get(version.itemId);
    if (
      !item ||
      item.status !== "DRAFT" ||
      item.latestVersionId !== input.versionId
    ) {
      return { ok: false as const, reason: "not_editable" as const };
    }
    const count = [...this.data.evidence.values()].filter(
      (e) => e.versionId === input.versionId,
    ).length;
    if (count >= KNOWLEDGE_EVIDENCE_CAP) {
      return { ok: false as const, reason: "cap_exceeded" as const };
    }
    const row: KnowledgeEvidenceRecord = {
      id: input.id,
      versionId: input.versionId,
      type: input.type,
      uri: input.uri,
      label: input.label ?? null,
      addedBy: input.addedBy,
      createdAt: nowIso(),
    };
    this.data.evidence.set(row.id, row);
    return { ok: true as const, row };
  }

  async listEvidence(versionId: string) {
    return [...this.data.evidence.values()]
      .filter((e) => e.versionId === versionId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
  }

  async getEvidence(id: string) {
    return this.data.evidence.get(id) ?? null;
  }

  async removeEvidence(id: string) {
    const row = this.data.evidence.get(id);
    if (!row) return { removed: false };
    const version = this.data.versions.get(row.versionId);
    const item = version ? this.data.items.get(version.itemId) : null;
    if (
      !item ||
      item.status !== "DRAFT" ||
      item.latestVersionId !== row.versionId
    ) {
      return { removed: false, reason: "not_editable" as const };
    }
    return { removed: this.data.evidence.delete(id) };
  }

  async itemsCiting(uri: string) {
    return [...this.data.evidence.values()]
      .filter((e) => e.uri === uri)
      .sort((a, b) => a.id.localeCompare(b.id));
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
