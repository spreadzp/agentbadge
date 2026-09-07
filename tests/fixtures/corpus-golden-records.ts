/**
 * SLICE-103-9: Golden anonymization fixture records.
 *
 * Used by PII sweep tests, corpus audit tests, and E2E privacy tests.
 */

import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";

// ── Base clean record (passes PII sweep) ─────────────────────

export const CLEAN_RECORD: CorpusRecord = {
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V0",
  timestamp: "2025-09-06T12:00:00Z",
  ruleset_version: "agent-readiness@1.2.0",
  schema_version: "0.11.0",
  scan_summary: {
    score: 72,
    grade: "B",
    total_rules: 15,
    applicable_rules: 14,
    status_counts: { VERIFIED: 10, INFERRED: 2, GAP: 1, CONFLICT: 0, NOT_APPLICABLE: 1 },
    pillar_scores: { discovery: 75, understandability: 65 },
  },
  category_scores: { api_description: 85, authentication: 60 },
  gap_pattern: {
    gap_ids: ["gap:documentation:pricing", "gap:authentication:oauth"],
    gap_types: { documentation: 1, authentication: 1 },
    gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 2, LOW: 0 },
  },
  conflict_rules: [],
  industry_vertical: "fintech",
  has_runtime_trace: false,
};

// ── PII variants (should fail PII sweep) ─────────────────────

export const RECORD_WITH_URL: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V1",
  industry_vertical: "https://example.com",
};

export const RECORD_WITH_EMAIL: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V2",
  industry_vertical: "user@example.com",
};

export const RECORD_WITH_IP: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V3",
  gap_pattern: {
    ...CLEAN_RECORD.gap_pattern,
    gap_ids: ["gap:server:192.168.1.1"],
  },
};

export const RECORD_WITH_DOMAIN: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V4",
  conflict_rules: ["api.example.com"],
};

export const RECORD_WITH_FTP_URL: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V5",
  industry_vertical: "ftp://files.example.com",
};

export const RECORD_WITH_NESTED_PII: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V6",
  scan_summary: {
    ...CLEAN_RECORD.scan_summary,
    pillar_scores: { discovery: 75, understandability: 65 },
  },
  // PII hidden in a deeply nested field
  category_scores: { "api_description": 85, "contact:admin@agentbadge.xyz": 0 },
};

export const RECORD_WITH_IPV6: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V7",
  industry_vertical: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
};

export const RECORD_WITH_PUBLIC_IP: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V8",
  industry_vertical: "8.8.8.8",
};

// ── Edge case clean records (should pass PII sweep) ──────────

export const RECORD_WITH_GAP_ID_PATTERN: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V9",
  gap_pattern: {
    gap_ids: ["gap:documentation:pricing", "gap:authentication:oauth", "gap:api_description:rate_limits"],
    gap_types: { documentation: 2, authentication: 1 },
    gap_priorities: { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 0 },
  },
};

export const RECORD_EMPTY_VERTICAL: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9VA",
  industry_vertical: "",
};

export const RECORD_NO_VERTICAL: CorpusRecord = {
  ...CLEAN_RECORD,
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9VB",
};

// ── Helper: all PII records for batch testing ────────────────

export const ALL_PII_RECORDS: Array<{ name: string; record: CorpusRecord }> = [
  { name: "URL", record: RECORD_WITH_URL },
  { name: "email", record: RECORD_WITH_EMAIL },
  { name: "IPv4", record: RECORD_WITH_IP },
  { name: "domain", record: RECORD_WITH_DOMAIN },
  { name: "FTP URL", record: RECORD_WITH_FTP_URL },
  { name: "nested PII", record: RECORD_WITH_NESTED_PII },
  { name: "IPv6", record: RECORD_WITH_IPV6 },
  { name: "public IP", record: RECORD_WITH_PUBLIC_IP },
];

export const ALL_CLEAN_RECORDS: Array<{ name: string; record: CorpusRecord }> = [
  { name: "clean base", record: CLEAN_RECORD },
  { name: "gap_id pattern", record: RECORD_WITH_GAP_ID_PATTERN },
  { name: "empty vertical", record: RECORD_EMPTY_VERTICAL },
  { name: "no vertical", record: RECORD_NO_VERTICAL },
];
