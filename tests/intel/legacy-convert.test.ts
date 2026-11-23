// EPIC-262 (SLICE-262-1): legacy compat — convert agentbadge-report.json
// (ruleset 1.x, schema_version 0.1.0) into the compatibility representation.
// Invariants (Q61=C): 100% of assertions preserved, evidence linked where it
// exists, assertions without evidence marked legacy_no_evidence — and ZERO
// fabrication of facts, timestamps, or provenance.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  convertLegacyReport,
  type LegacyCompatAssertion,
} from "../../src/server/lib/intel/evidence";

const FIXTURE = join(
  __dirname,
  "../../docs/EPICS/262-agent-surface-intelligence/spec/fixtures/legacy/agentbadge-report.json",
);

function loadReport() {
  return JSON.parse(readFileSync(FIXTURE, "utf8"));
}

describe("convertLegacyReport — real agentbadge-report.json fixture", () => {
  const report = loadReport();
  const out = convertLegacyReport(report);

  it("carries report-level identity into the compat header", () => {
    expect(out.source_report.report_id).toBe(report.report_id);
    expect(out.source_report.schema_version).toBe("0.1.0");
    expect(out.source_report.ruleset).toEqual(report.ruleset);
    expect(out.compatibility).toBe("legacy_agentbadge_report_v0.1");
  });

  it("preserves 100% of assertions — count matches, none dropped", () => {
    expect(out.assertions).toHaveLength(report.assertions.length);
  });

  it("keeps every assertion verbatim (no rewriting, no fabrication)", () => {
    for (const [i, compat] of out.assertions.entries()) {
      expect(compat.original).toEqual(report.assertions[i]);
    }
  });

  it("links evidence where present, marks legacy_no_evidence where absent", () => {
    const withEvidence = report.assertions.filter(
      (a: { evidence?: unknown[] }) => Array.isArray(a.evidence) && a.evidence.length > 0,
    ).length;
    const without = report.assertions.length - withEvidence;
    expect(out.assertions.filter((a) => !a.legacy_no_evidence)).toHaveLength(withEvidence);
    expect(out.assertions.filter((a) => a.legacy_no_evidence)).toHaveLength(without);
  });

  it("exposes inline evidence verbatim and digest-refs only where a hash existed", () => {
    for (const compat of out.assertions) {
      const orig = compat.original as { evidence?: Array<Record<string, unknown>> };
      expect(compat.evidence_inline).toEqual(orig.evidence ?? []);
      // compat refs are minted only from pre-existing content_hash — never invented
      const hashed = (orig.evidence ?? []).filter((e) => typeof e.content_hash === "string");
      expect(compat.evidence_refs).toHaveLength(hashed.length);
      for (const [j, ref] of compat.evidence_refs.entries()) {
        expect(ref.sha256).toBe(hashed[j].content_hash);
      }
    }
  });

  it("never fabricates provenance or backend timestamps on compat records", () => {
    for (const compat of out.assertions) {
      expect(compat).not.toHaveProperty("provenance");
      expect(compat).not.toHaveProperty("received_at");
      expect(compat).not.toHaveProperty("signature");
    }
  });
});

describe("convertLegacyReport — input validation", () => {
  it("rejects a report without an assertions array", () => {
    expect(() => convertLegacyReport({ report_id: "x" })).toThrow(/assertions/i);
  });

  it("rejects non-object input", () => {
    expect(() => convertLegacyReport("nope")).toThrow();
    expect(() => convertLegacyReport(null)).toThrow();
  });

  it("tolerates assertions with extra unknown fields (preserved verbatim)", () => {
    const out = convertLegacyReport({
      report_id: "r1",
      schema_version: "0.1.0",
      assertions: [{ rule_id: "AB-001", status: "VERIFIED", custom_field: { deep: 1 } }],
    });
    const compat: LegacyCompatAssertion = out.assertions[0];
    expect(compat.original).toEqual({ rule_id: "AB-001", status: "VERIFIED", custom_field: { deep: 1 } });
    expect(compat.legacy_no_evidence).toBe(true);
    expect(compat.evidence_inline).toEqual([]);
    expect(compat.evidence_refs).toEqual([]);
  });
});
