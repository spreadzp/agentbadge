// EPIC-262 (SLICE-262-1): legacy compat (Q61=C) — agentbadge-report.json
// (ruleset 1.x) → compatibility representation.
//
// Hard rules: every assertion is preserved VERBATIM; evidence objects are
// carried inline untouched; compat refs are minted only where the legacy
// evidence already carries a digest (content_hash) — size/media stay unknown
// rather than invented. Assertions without evidence get legacy_no_evidence.
// No provenance, no received_at, no signature — fabrication is forbidden;
// these records are NOT envelopes.
export interface LegacyCompatRef {
  evidence_ref_id: string;
  media_type: string;
  sha256: string;
}

export interface LegacyCompatAssertion {
  index: number;
  rule_id: string;
  /** the legacy assertion object, verbatim — nothing added, nothing dropped */
  original: Record<string, unknown>;
  evidence_inline: unknown[];
  evidence_refs: LegacyCompatRef[];
  legacy_no_evidence: boolean;
}

export interface LegacyCompatReport {
  compatibility: "legacy_agentbadge_report_v0.1";
  source_report: {
    report_id?: string;
    schema_version?: string;
    ruleset?: unknown;
  };
  assertions: LegacyCompatAssertion[];
}

export function convertLegacyReport(input: unknown): LegacyCompatReport {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("legacy report must be a JSON object");
  }
  const report = input as Record<string, unknown>;
  if (!Array.isArray(report.assertions)) {
    throw new Error("legacy report is missing the assertions array");
  }

  const assertions = report.assertions.map((raw, index) => {
    const original = (
      raw !== null && typeof raw === "object" ? raw : { value: raw }
    ) as Record<string, unknown>;
    const evidence = Array.isArray(original.evidence) ? original.evidence : [];
    const evidence_refs = evidence
      .filter(
        (e): e is Record<string, unknown> =>
          e !== null &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).content_hash === "string",
      )
      .map((e, j) => ({
        evidence_ref_id: `legacy:${index}:${j}`,
        media_type:
          typeof e.content_type === "string" ? e.content_type : "application/octet-stream",
        sha256: e.content_hash as string,
      }));
    return {
      index,
      rule_id: typeof original.rule_id === "string" ? original.rule_id : `legacy_${index}`,
      original,
      evidence_inline: evidence,
      evidence_refs,
      legacy_no_evidence: evidence.length === 0,
    } satisfies LegacyCompatAssertion;
  });

  return {
    compatibility: "legacy_agentbadge_report_v0.1",
    source_report: {
      report_id: typeof report.report_id === "string" ? report.report_id : undefined,
      schema_version:
        typeof report.schema_version === "string" ? report.schema_version : undefined,
      ruleset: report.ruleset,
    },
    assertions,
  };
}
