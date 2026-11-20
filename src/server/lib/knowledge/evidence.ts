import { randomUUID } from "node:crypto";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import {
  KNOWLEDGE_EVIDENCE_TYPES,
  type KnowledgeEvidenceRecord,
} from "./types";

/**
 * EPIC-229 (SLICE-229-6, D-229-9): version-scoped evidence refs —
 * the trust semantic of a source. Invariants:
 *   - type ∈ vocab
 *   - uri ≤ 1000 chars, absolute-URL or /path shape
 *   - ≤ 50 refs per version (D-206-5 analog — store enforces)
 *   - version must exist (store enforces → missing_version)
 */

const URI_MAX = 1000;

/** http(s)://… or a /path/to/thing — nothing exotic on a trust ref.
 *  \u0000 excluded explicitly (\S doesn't cover it; PG can't store it). */
const URI_RE = /^(https?:\/\/[^\s\u0000]+|\/[^\s\u0000]*)$/;

export async function addEvidence(
  store: KnowledgeStore,
  versionId: string,
  input: {
    type: string;
    uri: string;
    label?: string | null;
    addedBy: string;
  },
): Promise<KnowledgeResult<{ evidence: KnowledgeEvidenceRecord }>> {
  if (!KNOWLEDGE_EVIDENCE_TYPES.includes(input.type as never)) {
    return { ok: false, error: "bad_evidence_type", field: "type" };
  }
  const uri = input.uri.trim();
  const label = input.label ?? null;
  if (
    label !== null &&
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(label)
  ) {
    return { ok: false, error: "invalid_label", field: "label" };
  }
  if (uri.length === 0 || uri.length > URI_MAX || !URI_RE.test(uri)) {
    return {
      ok: false,
      error: "invalid_uri",
      field: "uri",
    };
  }
  const res = await store.addEvidence({
    id: `kev_${randomUUID()}`,
    versionId,
    type: input.type,
    uri,
    label,
    addedBy: input.addedBy,
  });
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.reason === "cap_exceeded" ? "evidence_cap" : "missing_version",
    };
  }
  emitKnowledgeEvent("knowledge.evidence_added", {
    evidenceId: res.row.id,
    versionId,
    type: res.row.type,
    uri: res.row.uri,
  });
  return { ok: true, evidence: res.row };
}

export function listEvidence(
  store: KnowledgeStore,
  versionId: string,
): Promise<KnowledgeEvidenceRecord[]> {
  return store.listEvidence(versionId);
}

/** Reverse lookup — every version citing this uri (staleness/withdrawal). */
export function itemsCiting(
  store: KnowledgeStore,
  uri: string,
): Promise<KnowledgeEvidenceRecord[]> {
  return store.itemsCiting(uri);
}

export async function removeEvidence(
  store: KnowledgeStore,
  id: string,
): Promise<KnowledgeResult<{ removed: boolean }>> {
  const res = await store.removeEvidence(id);
  return { ok: true, removed: res.removed };
}
