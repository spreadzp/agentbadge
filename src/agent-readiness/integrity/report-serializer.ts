import { generateReportId } from "./ulid";
import { computeContentHash } from "./content-hash";

export interface IntegrityBlock {
  content_hash: string;
  signature: {
    algorithm: "ed25519";
    key_id: string;
    value: string;
  };
}

export interface AgentReadinessReport {
  report_id: string;
  schema_version: "0.3.0";
  ruleset: { name: "agent-readiness"; version: "1.4.0" };
  scope: {
    agent_id: string;
    agent_version: string;
    endpoint_base_url: string;
    timestamp: string;
  };
  scanned_at: string;
  previous_hash: string | null;
  source_state?: string;
  score: {
    overall: number;
    grade: string;
    categories: Record<string, number>;
    delta?: number;
  };
  assertions: unknown[];
  pillars?: Record<string, unknown>;
  integrity: IntegrityBlock;
}

export interface ReportAssemblyInput {
  scope: {
    agent_id: string;
    agent_version: string;
    endpoint_base_url: string;
  };
  sourceState?: unknown;
  assertions: unknown[];
  scoreResult: {
    total: { score: number; grade?: string };
    categories: Record<string, { score: number }>;
    pillars?: Record<string, unknown>;
    delta?: { totalDelta: number } | null;
  };
  previousHash: string | null;
  keyId: string;
}

export function assembleReport(input: ReportAssemblyInput): AgentReadinessReport {
  const reportId = generateReportId();
  const scannedAt = new Date().toISOString();

  const score: Record<string, unknown> = {
    overall: input.scoreResult.total.score,
    grade: input.scoreResult.total.grade ?? "",
    categories: Object.fromEntries(
      Object.entries(input.scoreResult.categories).map(([k, v]) => [k, v.score]),
    ),
  };
  if (input.scoreResult.delta != null) {
    score.delta = input.scoreResult.delta.totalDelta;
  }

  const reportBody: Record<string, unknown> = {
    report_id: reportId,
    schema_version: "0.3.0",
    ruleset: { name: "agent-readiness", version: "1.4.0" },
    scope: {
      ...input.scope,
      timestamp: scannedAt,
    },
    scanned_at: scannedAt,
    previous_hash: input.previousHash,
    score,
    assertions: input.assertions,
  };
  if (input.sourceState != null) {
    reportBody.source_state = JSON.stringify(input.sourceState);
  }
  if (input.scoreResult.pillars != null) {
    reportBody.pillars = input.scoreResult.pillars;
  }

  const contentHash = computeContentHash(reportBody);

  const integrity: IntegrityBlock = {
    content_hash: contentHash,
    signature: {
      algorithm: "ed25519",
      key_id: input.keyId,
      value: "",
    },
  };

  return { ...reportBody, integrity } as AgentReadinessReport;
}
