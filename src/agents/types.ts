// Agent types & configuration (SLICE-26-1)

export interface MedicalAgentConfig {
  did: string;
  accountId: string;
  privateKey: string;
  tier: string;
  capabilities: string[];
  datahubGmsUrl?: string;
  hfsFileId?: string;
}

export type AnalysisType = "descriptive" | "correlation" | "risk_factors";

export interface DatasetMetadata {
  columns: string[];
  columnTypes: ("number" | "string" | "boolean")[];
  rowCount: number;
  sourceUrn?: string;
  datasetName: string;
}

export interface ColumnSummary {
  name: string;
  type: "number" | "string" | "boolean";
  count: number;
  nullCount: number;
  uniqueCount: number;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
}

export type DescriptiveStats = ColumnSummary[];

export interface CorrelationResult {
  columnX: string;
  columnY: string;
  coefficient: number;
  pValue: number;
  significant: boolean;
  strength: "weak" | "moderate" | "strong";
  direction: "positive" | "negative";
}

export interface CorrelationMatrix {
  columns: string[];
  matrix: number[][];
  pairs: CorrelationResult[];
}

export interface RiskFactorContributingFactor {
  metric: string;
  value: number;
  threshold: number;
  points: number;
  glossaryTerm: string;
}

export interface RiskFactorResult {
  factorName: string;
  datasetType: string;
  score: number;
  severity: "minimal" | "low" | "moderate" | "high";
  threshold: number;
  contributingFactors: RiskFactorContributingFactor[];
  glossaryTerms: string[];
}

export interface AnalysisReport {
  datasetName: string;
  analysisDate: string;
  descriptive: DescriptiveStats;
  correlation: CorrelationMatrix;
  riskFactors: RiskFactorResult[];
}

export interface ReportBundle {
  html: string;
  json: Record<string, unknown>;
  metadata: {
    agentDid: string;
    agentTier: string;
    taskId: string;
    timestamp: string;
  };
}

export interface VerifyResult {
  passed: boolean;
  failedChecks: string[];
  report: AnalysisReport;
  retryCount: number;
}

export interface TypedDataset {
  columns: string[];
  rows: (number | string | boolean | null)[][];
  types: ("number" | "string" | "boolean")[];
}

export interface BarChartData {
  labels: string[];
  values: number[];
  title?: string;
}

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
}

export interface HeatmapData {
  columns: string[];
  matrix: number[][];
}

// SLICE-26-9: JSON Report types

export interface TaskInfo {
  taskId: string;
  datasetUrn?: string;
  analysisType: string;
}

export interface JsonReport {
  taskId: string;
  agentDid: string;
  agentTier: string;
  analysisDate: string;
  datasetUrn: string;
  analysisType: string;
  datasetName: string;
  rowCount: number;
  descriptive: ColumnSummary[];
  correlations: CorrelationResult[];
  riskFactors: RiskFactorResult[];
  glossaryTermsReferenced: string[];
  summary: string;
}

export interface AssertionField {
  path: string;
  type: "STRING" | "NUMBER" | "BOOLEAN";
}

export interface AssertionConfig {
  type: "schema" | "freshness";
  compatibility?: "EXACT_MATCH" | "SUPERSET" | "SUBSET";
  description: string;
  fields?: AssertionField[];
  minGlossaryTerms?: number;
  minSignificantCorrelations?: number;
  meanRange?: { column: string; min: number; max: number };
  severityNotMinimal?: boolean;
}

export interface AssertionTemplate {
  analysisType: string;
  description: string;
  requiredGlossaryTerms: string[];
  assertions: AssertionConfig[];
}

export interface AssertionCheckResult {
  description: string;
  passed: boolean;
  message: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: AssertionCheckResult[];
  failedChecks: string[];
}
