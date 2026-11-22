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

/** Types whose URI must be a fetchable absolute http(s) URL —
 *  an "external" claim backed by a site-local path is nonsense. */
const HTTP_ONLY_EVIDENCE = new Set(["EXTERNAL_URL", "ONCHAIN_TX"]);

/** Arc R1 M9: URI shape is parsed, not regex'd — `//host` and `/\x`
 *  were protocol-relative/backslash smuggles agents resolve as
 *  external URLs; control chars beyond NUL slipped through \S.
 *  Schemes: http(s) everywhere; `internal:` + site-local `/path`
 *  for internal provenance types (seed/docs use them). */
function isValidEvidenceUri(type: string, uri: string): boolean {
  if (/[\p{C}\s]/u.test(uri)) return false;
  if (uri.startsWith("/")) {
    return (
      !HTTP_ONLY_EVIDENCE.has(type) &&
      uri.length > 1 &&
      uri[1] !== "/" &&
      uri[1] !== "\\"
    );
  }
  try {
    const u = new URL(uri);
    if (u.protocol === "https:" || u.protocol === "http:") return true;
    return u.protocol === "internal:" && !HTTP_ONLY_EVIDENCE.has(type);
  } catch {
    return false;
  }
}

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
  if (
    uri.length === 0 ||
    uri.length > URI_MAX ||
    !isValidEvidenceUri(input.type, uri)
  ) {
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
        res.reason === "cap_exceeded"
          ? "evidence_cap"
          : res.reason === "not_editable"
            ? "not_editable_in_status"
            : "missing_version",
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
  // Arc R1 H4: published/non-draft evidence is immutable — the
  // store's not_editable refusal maps to an honest error.
  if (res.reason === "not_editable") {
    return { ok: false, error: "not_editable_in_status" };
  }
  if (res.removed) {
    emitKnowledgeEvent("knowledge.evidence_removed", { evidenceId: id });
  }
  return { ok: true, removed: res.removed };
}
