import type {
  KnowledgeRepository,
  KnowledgeTaxonomyRepository,
} from "@agentbadge/database";

import type {
  KnowledgeCapabilityUpsert,
  KnowledgeEvidenceInsert,
  KnowledgeGapUpsert,
  KnowledgeItemInsert,
  KnowledgeRelationInsert,
  KnowledgeSearchOpts,
  KnowledgeStatusEventInsert,
  KnowledgeStore,
  KnowledgeTransitionInput,
  KnowledgeTransitionResult,
  KnowledgeVersionInsert,
} from "./store";
import type { KnowledgeGapRecord } from "./types";

/**
 * EPIC-229 (SLICE-229-1): Postgres adapter — KnowledgeRepository +
 * KnowledgeTaxonomyRepository behind the KnowledgeStore contract.
 * Rows already match the domain record shapes (ISO timestamps,
 * nullable strings); the only mapping is gap.sampleQueries (Json).
 */
export class DbKnowledgeStore implements KnowledgeStore {
  readonly backend = "postgres" as const;
  constructor(
    private readonly core: KnowledgeRepository,
    private readonly taxonomy: KnowledgeTaxonomyRepository,
  ) {}

  // ─── items ──

  getItem(id: string) {
    return this.core.getItem(id);
  }

  getItemBySlug(slug: string) {
    return this.core.getItemBySlug(slug);
  }

  listItems(opts?: { status?: string; kind?: string; limit?: number }) {
    return this.core.listItems(opts);
  }

  createItemWithVersion(
    item: KnowledgeItemInsert,
    version: KnowledgeVersionInsert,
    event: KnowledgeStatusEventInsert,
  ) {
    return this.core.createItemWithVersion(item, version, event);
  }

  addVersion(version: KnowledgeVersionInsert) {
    return this.core.addVersion(version);
  }

  // ─── versions ──

  getVersion(id: string) {
    return this.core.getVersion(id);
  }

  getVersionBySeq(itemId: string, seq: number) {
    return this.core.getVersionBySeq(itemId, seq);
  }

  listVersions(itemId: string) {
    return this.core.listVersions(itemId);
  }

  // ─── status machine ──

  async transitionItem(
    id: string,
    input: KnowledgeTransitionInput,
  ): Promise<KnowledgeTransitionResult> {
    const r = await this.core.transitionItem(id, input);
    if (!r.transitioned || r.event === null || r.item === null) {
      return {
        item: r.item,
        event: null,
        transitioned: false,
        reason: r.reason ?? "status_mismatch",
      };
    }
    return { item: r.item, event: r.event, transitioned: true };
  }

  listStatusEvents(itemId: string) {
    return this.core.listStatusEvents(itemId);
  }

  // ─── search seam ──

  searchItems(opts: KnowledgeSearchOpts) {
    return this.core.searchItems(opts);
  }

  // ─── capabilities ──

  upsertCapability(input: KnowledgeCapabilityUpsert) {
    return this.taxonomy.upsertCapability(input);
  }

  getCapability(id: string) {
    return this.taxonomy.getCapability(id);
  }

  getCapabilityByName(name: string) {
    return this.taxonomy.getCapabilityByName(name);
  }

  listCapabilities(opts?: { verified?: boolean; kind?: string; limit?: number }) {
    return this.taxonomy.listCapabilities(opts);
  }

  linkCapability(itemId: string, capabilityId: string) {
    return this.taxonomy.linkCapability(itemId, capabilityId);
  }

  unlinkCapability(itemId: string, capabilityId: string) {
    return this.taxonomy.unlinkCapability(itemId, capabilityId);
  }

  capabilitiesForItem(itemId: string) {
    return this.taxonomy.capabilitiesForItem(itemId);
  }

  itemsForCapability(name: string) {
    return this.taxonomy.itemsForCapability(name);
  }

  // ─── relations ──

  addRelation(input: KnowledgeRelationInsert) {
    return this.taxonomy.addRelation(input);
  }

  removeRelation(id: string) {
    return this.taxonomy.removeRelation(id);
  }

  relationsFor(itemId: string) {
    return this.taxonomy.relationsFor(itemId);
  }

  // ─── evidence ──

  async addEvidence(input: KnowledgeEvidenceInsert) {
    const r = await this.taxonomy.addEvidence(input);
    if (!r.ok) {
      return {
        ok: false as const,
        reason: r.reason as "missing_version" | "cap_exceeded",
      };
    }
    return { ok: true as const, row: r.row };
  }

  listEvidence(versionId: string) {
    return this.taxonomy.listEvidence(versionId);
  }

  removeEvidence(id: string) {
    return this.taxonomy.removeEvidence(id);
  }

  itemsCiting(uri: string) {
    return this.taxonomy.itemsCiting(uri);
  }

  // ─── gaps ──

  async recordGap(input: KnowledgeGapUpsert) {
    const r = await this.taxonomy.recordGap(input);
    return { row: mapGap(r.row), created: r.created };
  }

  async getGap(id: string) {
    const row = await this.taxonomy.getGap(id);
    return row ? mapGap(row) : null;
  }

  async listGaps(opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen";
    limit?: number;
  }) {
    const rows = await this.taxonomy.listGaps(opts);
    return rows.map(mapGap);
  }

  async transitionGap(
    id: string,
    input: { from: string; to: string; linkedItemId?: string | null },
  ) {
    const r = await this.taxonomy.transitionGap(id, input);
    return {
      gap: r.gap ? mapGap(r.gap) : null,
      transitioned: r.transitioned,
      reason: r.reason as "missing" | "status_mismatch" | undefined,
    };
  }
}

/** Json column → typed samples; everything else is pass-through. */
function mapGap(row: {
  id: string;
  normalizedQuery: string;
  sampleQueries: unknown;
  count: number;
  capabilityRef: string | null;
  intent: string | null;
  source: string;
  sourceRef: string | null;
  status: string;
  linkedItemId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}): KnowledgeGapRecord {
  return {
    ...row,
    sampleQueries: Array.isArray(row.sampleQueries)
      ? row.sampleQueries.filter((s): s is string => typeof s === "string")
      : [],
  };
}
