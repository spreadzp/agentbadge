// EPIC-262 (SLICE-262-5): canonical report assembly — pure builder:
// envelopes + explicit context in, signed report out. The assembler
// never invents job state (completeness arrives from the caller/job
// rules — 262-6) and never merges the two score surfaces (D-UX-Q3).
import { createHash } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";
import type { CanonicalEnvelope, Provenance } from "../evidence";
import { runRuleset, scoreFindings } from "../rules";
import type { IntelRuleset } from "../rules";
import { signReport } from "./sign";
import type { IntelReport } from "./schema";

export interface AssembleIntelReportInput {
  site_id: string;
  scan_id: string;
  completeness: "complete" | "partial";
  generated_at: string;
  report_id: string;
  previous_hash: string | null;
  ruleset: IntelRuleset;
  key: SigningKey;
}

export function assembleIntelReport(
  envelopes: CanonicalEnvelope[],
  input: AssembleIntelReportInput,
): IntelReport {
  const findings = runRuleset(envelopes, input.ruleset.rules);
  const scores = scoreFindings(findings, input.ruleset.ruleset_version);

  const provenance: Partial<Record<Provenance, number>> = {};
  for (const e of envelopes) {
    provenance[e.provenance] = (provenance[e.provenance] ?? 0) + 1;
  }

  const body = {
    schema_version: "1.0" as const,
    report_id: input.report_id,
    site_id: input.site_id,
    ruleset: {
      name: "agent-surface-wp",
      version: input.ruleset.ruleset_version,
    },
    scan: {
      scan_id: input.scan_id,
      completeness: input.completeness,
      generated_at: input.generated_at,
    },
    evidence: {
      envelope_count: envelopes.length,
      collected_at_min:
        envelopes
          .map((e) => e.collected_at)
          .sort()
          .at(0) ?? null,
      received_at_max:
        envelopes
          .map((e) => e.received_at)
          .sort()
          .at(-1) ?? null,
      provenance,
    },
    findings,
    scores: {
      readiness: scores.readiness,
      exposure: scores.exposure,
    },
    previous_hash: input.previous_hash,
  };

  const content_hash = `sha256:${createHash("sha256")
    .update(canonicalizeJson(body), "utf8")
    .digest("hex")}`;

  return signReport(
    { ...body, integrity: { content_hash } },
    input.key,
  );
}
