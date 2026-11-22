import { randomUUID } from "node:crypto";
import ipaddr from "ipaddr.js";

import { emitKnowledgeEvent } from "./events";
import type { KnowledgeResult } from "./items";
import type { KnowledgeStore } from "./store";
import {
  KNOWLEDGE_EVIDENCE_TYPES,
  noCtrlStrict,
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
    if (u.protocol === "https:" || u.protocol === "http:") {
      // Arc R3 M-3: userinfo is never stored (it lands in events);
      // external-claim types must cite a PUBLIC host at add time.
      if (u.username !== "" || u.password !== "") return false;
      return HTTP_ONLY_EVIDENCE.has(type)
        ? isPublicEvidenceUri(uri)
        : true;
    }
    // Arc R3 M-3: `internal:` only for internal provenance types.
    return u.protocol === "internal:" && !HTTP_ONLY_EVIDENCE.has(type);
  } catch {
    return false;
  }
}

/** Arc R3 M-3: parsed classification via ipaddr.js range() — RFC
 *  tables stay maintained upstream instead of a hand-rolled denylist
 *  (the old `\[?fc|\[?fd` prefix regex matched `fda.gov`/`fcc.gov` AND
 *  missed mapped v6, NAT64, CGNAT, site-local and dotless hosts).
 *  Only `unicast` counts as public: private/loopback/linkLocal/
 *  multicast/reserved/CGNAT/broadcast/as112 (v4) and uniqueLocal/
 *  mapped/rfc6145/rfc6052/6to4/teredo/site-local/discard/orchid/SR
 *  (v6) all refuse — transition mechanisms aren't citation hosts. */
function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    h === "" ||
    h === "localhost" ||
    /\.(local|internal|lan|corp|home|test|invalid|example|localhost)$/.test(h)
  ) {
    return true;
  }
  if (ipaddr.IPv4.isValid(h)) {
    return ipaddr.IPv4.parse(h).range() !== "unicast";
  }
  if (h.includes(":")) {
    if (!ipaddr.IPv6.isValid(h)) return true; // unparseable v6 → refuse
    const v6 = ipaddr.IPv6.parse(h);
    // ::ffff:a.b.c.d (hextet form too) — classify the embedded v4.
    if (v6.isIPv4MappedAddress()) {
      return v6.toIPv4Address().range() !== "unicast";
    }
    return v6.range() !== "unicast";
  }
  // dotless = intranet single-label name
  return !h.includes(".");
}

/** Arc R2 M-4 + R3 M-3: public projection boundary for evidence
 *  URIs. A uri is public iff it's absolute http(s), carries no
 *  userinfo, and parses to a global hostname — no IP literal
 *  unless global unicast, no dotless/intranet names. */
export function isPublicEvidenceUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.username !== "" || u.password !== "") return false;
    return !isPrivateHost(u.hostname);
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
    (label.length > 300 || !noCtrlStrict(label))
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

/** Arc R3 H-2: canonical fingerprint of an evidence SET — sorted
 *  ids joined by "|". Rendered into transition forms as
 *  `expectedEvidence` and recomputed under the item row lock at
 *  VERIFY, so a stale page can't approve evidence it never saw. */
export function evidenceFingerprint(rows: { id: string }[]): string {
  return rows
    .map((r) => r.id)
    .sort()
    .join("|");
}

export async function removeEvidence(
  store: KnowledgeStore,
  id: string,
  actor?: string,
): Promise<KnowledgeResult<{ removed: boolean }>> {
  const res = await store.removeEvidence(id);
  // Arc R1 H4: published/non-draft evidence is immutable — the
  // store's not_editable refusal maps to an honest error.
  if (res.reason === "not_editable") {
    return { ok: false, error: "not_editable_in_status" };
  }
  if (res.removed) {
    // Arc R2 M-11 + R3 M-12: actor attribution + WHAT was removed —
    // an unattributed/unlabeled removal is an audit hole.
    emitKnowledgeEvent("knowledge.evidence_removed", {
      evidenceId: id,
      type: res.row?.type ?? null,
      uri: res.row?.uri ?? null,
      actor: actor ?? null,
    });
  }
  return { ok: true, removed: res.removed };
}
