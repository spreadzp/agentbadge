import type {
  KnowledgeRepository,
  KnowledgeTaxonomyRepository,
} from "@agentbadge/database";

import type {
  KnowledgeCapabilityUpsert,
  KnowledgeEvidenceInsert,
  KnowledgeGapAssignInput,
  KnowledgeGapTransitionInput,
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
import { cjkTerms, orTsquery } from "./terms";
import type { KnowledgeGapRecord } from "./types";
import type {
  KnowledgeGapEventInsert,
  KnowledgeGapEventRecord,
} from "./gap-events";
import type {
  KnowledgeGapOverdueInsert,
  KnowledgeGapOverduePending,
  KnowledgeGapOverdueRecord,
  KnowledgeGapMetrics,
} from "./gap-overdue";

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

  getItem = (id: string) => this.core.getItem(id);
  getItemBySlug = (slug: string) => this.core.getItemBySlug(slug);
  listItems = (opts?: { status?: string; kind?: string; limit?: number }) =>
    this.core.listItems(opts);

  createItemWithVersion(
    item: KnowledgeItemInsert,
    version: KnowledgeVersionInsert,
    event: KnowledgeStatusEventInsert,
  ) {
    return this.core.createItemWithVersion(item, version, event);
  }

  addVersion(
    version: Omit<KnowledgeVersionInsert, "seq"> & {
      copyEvidenceFromLatest?: boolean;
      expectedSeq?: number;
    },
    opts?: { requireStatus?: string },
  ) {
    return this.core.addVersion(version, opts);
  }

  // ─── versions ──

  getVersion = (id: string) => this.core.getVersion(id);
  getVersionBySeq = (itemId: string, seq: number) =>
    this.core.getVersionBySeq(itemId, seq);
  listVersions = (itemId: string) => this.core.listVersions(itemId);

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

  listStatusEvents = (itemId: string) =>
    this.core.listStatusEvents(itemId);

  // ─── search seam ──

  async searchItems(opts: KnowledgeSearchOpts) {
    // Arc R2 M-3: tokenize through the shared terms module and hand
    // the repo an OR-tsquery — plainto ANDs all lexemes after
    // stopword stripping, so plain questions refused to match.
    const tsquery = orTsquery(opts.query);
    if (tsquery === undefined) return [];
    // Arc R4 M-5: the tsquery lane can't match CJK bigrams inside
    // unsegmented runs — hand the repo the same term list for its
    // ILIKE substring lane.
    const cjk = cjkTerms(opts.query);
    return this.core.searchItems({
      ...opts,
      tsquery,
      cjkTerms: cjk.length > 0 ? cjk.join("|") : undefined,
    });
  }

  // ─── capabilities ──

  upsertCapability = (input: KnowledgeCapabilityUpsert) =>
    this.taxonomy.upsertCapability(input);
  getCapability = (id: string) => this.taxonomy.getCapability(id);
  getCapabilityByName = (name: string) =>
    this.taxonomy.getCapabilityByName(name);
  listCapabilities = (opts?: {
    verified?: boolean;
    kind?: string;
    limit?: number;
  }) => this.taxonomy.listCapabilities(opts);
  linkCapability = (itemId: string, capabilityId: string) =>
    this.taxonomy.linkCapability(itemId, capabilityId);
  unlinkCapability = (itemId: string, capabilityId: string) =>
    this.taxonomy.unlinkCapability(itemId, capabilityId);
  capabilitiesForItem = (itemId: string) =>
    this.taxonomy.capabilitiesForItem(itemId);
  itemsForCapability = (name: string) =>
    this.taxonomy.itemsForCapability(name);

  // ─── relations ──

  addRelation = (input: KnowledgeRelationInsert) =>
    this.taxonomy.addRelation(input);
  removeRelation = (id: string) => this.taxonomy.removeRelation(id);
  relationsFor = (itemId: string) => this.taxonomy.relationsFor(itemId);

  // ─── evidence ──

  async addEvidence(input: KnowledgeEvidenceInsert) {
    const r = await this.taxonomy.addEvidence(input);
    if (!r.ok) {
      return {
        ok: false as const,
        reason: r.reason as
          | "missing_version"
          | "cap_exceeded"
          | "not_editable",
      };
    }
    return { ok: true as const, row: r.row };
  }

  listEvidence(versionId: string) {
    return this.taxonomy.listEvidence(versionId);
  }

  getEvidence(id: string) {
    return this.taxonomy.getEvidence(id);
  }

  removeEvidence(id: string) {
    return this.taxonomy.removeEvidence(id);
  }

  itemsCiting(uri: string) {
    return this.taxonomy.itemsCiting(uri);
  }

  // ─── gaps ──

  async recordGap(input: KnowledgeGapUpsert, opts?: { openCap?: number }) {
    const r = await this.taxonomy.recordGap(input, undefined, opts);
    return {
      row: r.row ? mapGap(r.row) : null,
      created: r.created,
      recorded: r.recorded,
      reopened: r.reopened,
    };
  }

  async getGap(id: string) {
    const row = await this.taxonomy.getGap(id);
    return row ? mapGap(row) : null;
  }

  countGaps(status: string) {
    return this.taxonomy.countGaps(status);
  }

  async listGaps(opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen" | "overdue";
    unassigned?: boolean;
    overdueOnly?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const rows = await this.taxonomy.listGaps(opts);
    return rows.map(mapGap);
  }

  async transitionGap(id: string, input: KnowledgeGapTransitionInput) {
    const r = await this.taxonomy.transitionGap(id, input);
    return {
      gap: r.gap ? mapGap(r.gap) : null,
      transitioned: r.transitioned,
      reason: r.reason as "missing" | "status_mismatch" | undefined,
    };
  }

  async assignGap(id: string, input: KnowledgeGapAssignInput) {
    const r = await this.taxonomy.assignGap(id, input);
    return {
      gap: r.gap ? mapGap(r.gap) : null,
      updated: r.updated,
      reason: r.reason as "missing" | "conflict" | undefined,
    };
  }

  // ─── 264-11: persisted gap audit ──

  appendGapEvent(event: KnowledgeGapEventInsert) {
    return this.taxonomy.appendGapEvent(event);
  }

  async listGapEvents(gapId: string): Promise<KnowledgeGapEventRecord[]> {
    // Row shape already matches the record — no mapping needed.
    return this.taxonomy.listGapEvents(gapId);
  }

  // ─── 264-13: durable overdue-breach records ──

  async recordOverdue(
    input: KnowledgeGapOverdueInsert,
  ): Promise<{ row: KnowledgeGapOverdueRecord | null; created: boolean }> {
    // Row shape already matches the record — no mapping needed.
    return this.taxonomy.recordOverdue(input);
  }

  markOverdueEmitted(id: string) {
    return this.taxonomy.markOverdueEmitted(id);
  }

  async listDueBreaches(now: string): Promise<KnowledgeGapRecord[]> {
    const rows = await this.taxonomy.listDueBreaches(now);
    return rows.map(mapGap);
  }

  listPendingOverdueEmits(): Promise<KnowledgeGapOverduePending[]> {
    // Projection shape already matches — no mapping needed.
    return this.taxonomy.listPendingOverdueEmits();
  }

  gapMetrics(input: {
    now: string;
    resolvedSince: string;
  }): Promise<KnowledgeGapMetrics> {
    return this.taxonomy.gapMetrics(input);
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
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
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
