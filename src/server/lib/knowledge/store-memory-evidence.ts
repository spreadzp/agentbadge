import type { KnowledgeEvidenceInsert } from "./store";
import type { KnowledgeEvidenceRecord } from "./types";
import {
  KNOWLEDGE_EVIDENCE_CAP,
  nowIso,
  type MemoryKnowledgeData,
} from "./memory-data";

/**
 * EPIC-229 (SLICE-229-1): memory-side version evidence — split from
 * store-memory-taxonomy (300-line file cap). Honest-signal shapes
 * identical to the Postgres adapter.
 */
export class MemoryKnowledgeEvidence {
  constructor(protected readonly data: MemoryKnowledgeData) {}

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
    // Arc R3 M-12: hand the row back so the audit event carries
    // what was removed.
    this.data.evidence.delete(id);
    return { removed: true, row };
  }

  async itemsCiting(uri: string) {
    return [...this.data.evidence.values()]
      .filter((e) => e.uri === uri)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
