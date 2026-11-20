import type {
  KnowledgeCapabilityUpsert,
  KnowledgeEvidenceInsert,
  KnowledgeGapUpsert,
  KnowledgeRelationInsert,
} from "./store";
import type {
  KnowledgeCapabilityRecord,
  KnowledgeEvidenceRecord,
  KnowledgeGapRecord,
  KnowledgeRelationRecord,
} from "./types";
import {
  KNOWLEDGE_EVIDENCE_CAP,
  KNOWLEDGE_GAP_SAMPLES_CAP,
  linkKey,
  nowIso,
  type MemoryKnowledgeData,
} from "./memory-data";

/**
 * EPIC-229 (SLICE-229-1): memory-side taxonomy — capabilities, m:n
 * links, typed relations, version evidence, knowledge gaps. Mirrors
 * the DB-side KnowledgeTaxonomyRepository split. Honest-signal
 * shapes identical to the Postgres adapter.
 */
export class MemoryKnowledgeTaxonomy {
  constructor(protected readonly data: MemoryKnowledgeData) {}

  // ─── capabilities ──

  async upsertCapability(input: KnowledgeCapabilityUpsert) {
    const existing = [...this.data.capabilities.values()].find(
      (c) => c.name === input.name,
    );
    if (existing) {
      existing.kind = input.kind;
      existing.description = input.description ?? null;
      existing.verified = input.verified;
      existing.source = input.source;
      existing.updatedAt = nowIso();
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
      .map((k) => k.split("::")[0]);
  }

  // ─── relations ──

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
    return { removed: this.data.relations.delete(id) };
  }

  async relationsFor(itemId: string) {
    const outgoing: KnowledgeRelationRecord[] = [];
    const incoming: KnowledgeRelationRecord[] = [];
    for (const r of this.data.relations.values()) {
      if (r.fromItemId === itemId) outgoing.push(r);
      if (r.toItemId === itemId) incoming.push(r);
    }
    return { outgoing, incoming };
  }

  // ─── evidence ──

  async addEvidence(input: KnowledgeEvidenceInsert) {
    if (!this.data.versions.has(input.versionId)) {
      return { ok: false as const, reason: "missing_version" as const };
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
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async removeEvidence(id: string) {
    return { removed: this.data.evidence.delete(id) };
  }

  async itemsCiting(uri: string) {
    return [...this.data.evidence.values()].filter((e) => e.uri === uri);
  }

  // ─── gaps ──

  async recordGap(input: KnowledgeGapUpsert) {
    const now = nowIso();
    for (const gap of this.data.gaps.values()) {
      if (gap.normalizedQuery !== input.normalizedQuery) continue;
      gap.count += 1;
      gap.lastSeenAt = now;
      if (gap.capabilityRef == null && input.capabilityRef != null) {
        gap.capabilityRef = input.capabilityRef;
      }
      if (gap.intent == null && input.intent != null) {
        gap.intent = input.intent;
      }
      if (
        gap.sampleQueries.length < KNOWLEDGE_GAP_SAMPLES_CAP &&
        !gap.sampleQueries.includes(input.sampleQuery)
      ) {
        gap.sampleQueries.push(input.sampleQuery);
      }
      return { row: gap, created: false };
    }
    const gap: KnowledgeGapRecord = {
      id: input.id,
      normalizedQuery: input.normalizedQuery,
      sampleQueries: [input.sampleQuery],
      count: 1,
      capabilityRef: input.capabilityRef ?? null,
      intent: input.intent ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      status: "OPEN",
      linkedItemId: null,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    this.data.gaps.set(gap.id, gap);
    return { row: gap, created: true };
  }

  async getGap(id: string) {
    return this.data.gaps.get(id) ?? null;
  }

  async listGaps(opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen";
    limit?: number;
  }) {
    let rows = [...this.data.gaps.values()];
    if (opts?.status !== undefined) {
      rows = rows.filter((g) => g.status === opts.status);
    }
    rows.sort(
      opts?.orderBy === "lastSeen"
        ? (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)
        : (a, b) => b.count - a.count,
    );
    return rows.slice(0, opts?.limit ?? 500);
  }

  async transitionGap(
    id: string,
    input: { from: string; to: string; linkedItemId?: string | null },
  ) {
    const gap = this.data.gaps.get(id);
    if (!gap) {
      return { gap: null, transitioned: false, reason: "missing" as const };
    }
    if (gap.status !== input.from) {
      return {
        gap,
        transitioned: false,
        reason: "status_mismatch" as const,
      };
    }
    gap.status = input.to;
    if (input.linkedItemId !== undefined) gap.linkedItemId = input.linkedItemId;
    return { gap, transitioned: true };
  }
}
