import type { AnalysisReport, DatasetMetadata, MedicalAgentConfig, TypedDataset, ReportBundle } from "../types";
import { computeDescriptiveStats } from "./descriptive";
import { correlationMatrix, significantCorrelations } from "./correlation";
import { computeRiskFactors } from "./risk-factors";
import { generateHtmlLayout } from "../report/html-layout";

export function runAnalysisPipeline(
  dataset: TypedDataset,
  datasetName: string,
  datasetType: string,
): AnalysisReport {
  const descriptive = computeDescriptiveStats(dataset);
  const correlation = correlationMatrix(dataset);
  const riskFactors = computeRiskFactors(dataset, descriptive, datasetType);

  return {
    datasetName,
    analysisDate: new Date().toISOString(),
    descriptive,
    correlation,
    riskFactors,
  };
}

export function buildDatasetMetadata(dataset: TypedDataset, name: string): DatasetMetadata {
  return {
    columns: dataset.columns,
    columnTypes: dataset.types,
    rowCount: dataset.rows.length,
    datasetName: name,
  };
}

const DEFAULT_CONFIG: MedicalAgentConfig = {
  did: "did:hcs:0.0.0:2",
  accountId: "0.0.2",
  privateKey: "",
  tier: "gold",
  capabilities: ["medical-analysis"],
};

export function generateAnalysisReport(
  dataset: TypedDataset,
  datasetName: string,
  datasetType: string,
): string {
  const report = runAnalysisPipeline(dataset, datasetName, datasetType);
  const metadata = buildDatasetMetadata(dataset, datasetName);
  return generateHtmlLayout(report, metadata, DEFAULT_CONFIG);
}

export function generateReportBundle(
  dataset: TypedDataset,
  datasetName: string,
  datasetType: string,
  taskId: string,
): ReportBundle {
  const report = runAnalysisPipeline(dataset, datasetName, datasetType);
  const metadata = buildDatasetMetadata(dataset, datasetName);
  const html = generateHtmlLayout(report, metadata, DEFAULT_CONFIG);

  return {
    html,
    json: report as unknown as Record<string, unknown>,
    metadata: {
      agentDid: DEFAULT_CONFIG.did,
      agentTier: DEFAULT_CONFIG.tier,
      taskId,
      timestamp: new Date().toISOString(),
    },
  };
}
