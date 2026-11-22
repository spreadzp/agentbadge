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
  KnowledgeVersionInsert,
} from "./store";
import type { MemoryKnowledgeData } from "./memory-data";
import { MemoryKnowledgeCore } from "./store-memory-core";
import { MemoryKnowledgeGaps } from "./store-memory-gaps";
import { MemoryKnowledgeTaxonomy } from "./store-memory-taxonomy";

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
  private readonly gaps: MemoryKnowledgeGaps;

  constructor(data: MemoryKnowledgeData) {
    this.core = new MemoryKnowledgeCore(data);
    this.taxonomy = new MemoryKnowledgeTaxonomy(data);
    this.gaps = new MemoryKnowledgeGaps(data);
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
  addVersion = (version: KnowledgeVersionInsert) =>
    this.core.addVersion(version);
  getVersion = (id: string) => this.core.getVersion(id);
  getVersionBySeq = (itemId: string, seq: number) =>
    this.core.getVersionBySeq(itemId, seq);
  listVersions = (itemId: string) => this.core.listVersions(itemId);
  transitionItem = (id: string, input: KnowledgeTransitionInput) =>
    this.core.transitionItem(id, input);
  listStatusEvents = (itemId: string) => this.core.listStatusEvents(itemId);
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
    this.taxonomy.addEvidence(input);
  listEvidence = (versionId: string) => this.taxonomy.listEvidence(versionId);
  getEvidence = (id: string) => this.taxonomy.getEvidence(id);
  removeEvidence = (id: string) => this.taxonomy.removeEvidence(id);
  itemsCiting = (uri: string) => this.taxonomy.itemsCiting(uri);

  // ─── gaps ──
  recordGap = (input: KnowledgeGapUpsert) => this.gaps.recordGap(input);
  getGap = (id: string) => this.gaps.getGap(id);
  countGaps = (status: string) => this.gaps.countGaps(status);
  listGaps = (opts?: {
    status?: string;
    orderBy?: "count" | "lastSeen";
    limit?: number;
  }) => this.gaps.listGaps(opts);
  transitionGap = (
    id: string,
    input: { from: string; to: string; linkedItemId?: string | null },
  ) => this.gaps.transitionGap(id, input);
}
