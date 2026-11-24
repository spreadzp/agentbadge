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
  KnowledgeVersionInsert,
} from "./store";
import type { KnowledgeGapEventInsert } from "./gap-events";
import type { KnowledgeGapOverdueInsert } from "./gap-overdue";
import type { MemoryKnowledgeData } from "./memory-data";
import { MemoryKnowledgeCore } from "./store-memory-core";
import { MemoryKnowledgeEvidence } from "./store-memory-evidence";
import { MemoryKnowledgeGaps } from "./store-memory-gaps";
import { MemoryKnowledgeOverdue } from "./store-memory-overdue";
import { MemoryKnowledgeTaxonomy } from "./store-memory-taxonomy";
import { MemoryKnowledgeTransitions } from "./store-memory-transitions";

/**
 * EPIC-229 (SLICE-229-1): in-memory KnowledgeStore — the
 * DATABASE_ENABLED=off fallback that MUST match the Postgres
 * adapter's contract (D-143). Facade over the core-aggregate,
 * taxonomy and gaps slices (300-line file cap forced the splits —
 * mirrors the DB-side KnowledgeRepository /
 * KnowledgeTaxonomyRepository split).
 */
export class MemoryKnowledgeStore implements KnowledgeStore {
  readonly backend = "memory" as const;
  private readonly core: MemoryKnowledgeCore;
  private readonly taxonomy: MemoryKnowledgeTaxonomy;
  private readonly evidence: MemoryKnowledgeEvidence;
  private readonly gaps: MemoryKnowledgeGaps;
  private readonly overdue: MemoryKnowledgeOverdue;
  private readonly transitions: MemoryKnowledgeTransitions;

  constructor(data: MemoryKnowledgeData) {
    this.core = new MemoryKnowledgeCore(data);
    this.taxonomy = new MemoryKnowledgeTaxonomy(data);
    this.evidence = new MemoryKnowledgeEvidence(data);
    this.gaps = new MemoryKnowledgeGaps(data);
    this.overdue = new MemoryKnowledgeOverdue(data);
    this.transitions = new MemoryKnowledgeTransitions(data);
  }

  // ─── items / versions / events ──
  getItem = (id: string) => this.core.getItem(id);
  getItemBySlug = (slug: string) => this.core.getItemBySlug(slug);
  listItems = (opts?: { status?: string; kind?: string; limit?: number }) =>
    this.core.listItems(opts);
  createItemWithVersion = (
    item: KnowledgeItemInsert,
    version: KnowledgeVersionInsert,
    event: KnowledgeStatusEventInsert,
  ) => this.core.createItemWithVersion(item, version, event);
  addVersion = (
    version: Omit<KnowledgeVersionInsert, "seq"> & {
      copyEvidenceFromLatest?: boolean;
      expectedSeq?: number;
    },
    opts?: { requireStatus?: string },
  ) => this.core.addVersion(version, opts);
  getVersion = (id: string) => this.core.getVersion(id);
  getVersionBySeq = (itemId: string, seq: number) =>
    this.core.getVersionBySeq(itemId, seq);
  listVersions = (itemId: string) => this.core.listVersions(itemId);
  transitionItem = (id: string, input: KnowledgeTransitionInput) =>
    this.transitions.transitionItem(id, input);
  listStatusEvents = (itemId: string) =>
    this.transitions.listStatusEvents(itemId);
  searchItems = (opts: KnowledgeSearchOpts) =>
    this.taxonomy.searchItems(opts);

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
  addEvidence = (input: KnowledgeEvidenceInsert) =>
    this.evidence.addEvidence(input);
  listEvidence = (versionId: string) => this.evidence.listEvidence(versionId);
  getEvidence = (id: string) => this.evidence.getEvidence(id);
  removeEvidence = (id: string) => this.evidence.removeEvidence(id);
  itemsCiting = (uri: string) => this.evidence.itemsCiting(uri);

  // ─── gaps ──
  recordGap = (
    input: KnowledgeGapUpsert,
    opts?: { openCap?: number },
  ) => this.gaps.recordGap(input, opts);
  getGap = (id: string) => this.gaps.getGap(id);
  countGaps = (status: string) => this.gaps.countGaps(status);
  listGaps = (opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen";
    limit?: number;
    offset?: number;
  }) => this.gaps.listGaps(opts);
  transitionGap = (id: string, input: KnowledgeGapTransitionInput) =>
    this.gaps.transitionGap(id, input);
  assignGap = (id: string, input: KnowledgeGapAssignInput) =>
    this.gaps.assignGap(id, input);
  appendGapEvent = (event: KnowledgeGapEventInsert) =>
    this.gaps.appendGapEvent(event);
  listGapEvents = (gapId: string) => this.gaps.listGapEvents(gapId);

  // ─── 264-13: durable overdue-breach records ──
  recordOverdue = (input: KnowledgeGapOverdueInsert) =>
    this.overdue.recordOverdue(input);
  markOverdueEmitted = (id: string) => this.overdue.markOverdueEmitted(id);
  listDueBreaches = (now: string) => this.overdue.listDueBreaches(now);
  listPendingOverdueEmits = () => this.overdue.listPendingOverdueEmits();
  gapMetrics = (input: { now: string; resolvedSince: string }) =>
    this.overdue.gapMetrics(input);
}
