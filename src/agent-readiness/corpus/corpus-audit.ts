/**
 * SLICE-103-9: Corpus-wide PII audit.
 *
 * Loads all records from a CorpusStore, sweeps each for PII,
 * and returns a comprehensive audit result.
 */

import type { CorpusStore } from "./corpus-store";
import { sweepForPii } from "./pii-sweep";

export interface CorpusAuditFinding {
  record_id: string;
  field: string;
  pattern: string;
}

export interface CorpusAuditResult {
  total_records: number;
  clean_records: number;
  flagged_records: number;
  findings: CorpusAuditFinding[];
  passed: boolean;
}

/**
 * Audit all records in a CorpusStore for PII.
 * Returns passed=true if no PII found in any record.
 */
export async function auditCorpusForPii(store: CorpusStore): Promise<CorpusAuditResult> {
  const records = await store.query({});
  const findings: CorpusAuditFinding[] = [];

  for (const record of records) {
    const result = sweepForPii(record);
    if (!result.clean) {
      for (const finding of result.findings) {
        // Parse finding format: 'PatternType: "value" in "field"'
        const colonIdx = finding.indexOf(":");
        const pattern = finding.slice(0, colonIdx).trim();
        const rest = finding.slice(colonIdx + 1).trim();
        // Extract field name from 'in "fieldname"' or use the value
        const inMatch = rest.match(/in "(.*)"$/);
        const field = inMatch ? inMatch[1] : rest;

        findings.push({
          record_id: record.record_id,
          field,
          pattern,
        });
      }
    }
  }

  const flaggedRecords = new Set(findings.map((f) => f.record_id));

  return {
    total_records: records.length,
    clean_records: records.length - flaggedRecords.size,
    flagged_records: flaggedRecords.size,
    findings,
    passed: findings.length === 0,
  };
}
