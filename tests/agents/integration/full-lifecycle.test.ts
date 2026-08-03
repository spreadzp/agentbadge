/**
 * SLICE-26-13: Integration test — full lifecycle with 3 datasets
 */

import { describe, it, expect } from "bun:test";
import { runAnalysisPipeline } from "../../../src/agents/analysis/pipeline";
import { generateHtmlLayout } from "../../../src/agents/report/html-layout";
import { generateJsonReport, validateJsonReport } from "../../../src/agents/report/json-report";
import type { AnalysisReport, AssertionTemplate, DatasetMetadata, MedicalAgentConfig, TaskInfo } from "../../../src/agents/types";
import { runSelfCorrectingLoop } from "../../../src/agents/self-correcting-loop";
import { mockPimaDataset, mockHeartDataset, mockBreastCancerDataset } from "../helpers/mock-data";

const TEMPLATE: AssertionTemplate = {
  analysisType: "descriptive",
  description: "Integration test assertions",
  requiredGlossaryTerms: ["urn:li:glossaryTerm:Glucose"],
  assertions: [
    { type: "schema", description: "All fields present" },
    { type: "freshness", description: "Has glossary terms", minGlossaryTerms: 1 },
  ],
};

function runFullLifecycle(datasetName: string, datasetType: string, dataset: ReturnType<typeof mockPimaDataset>) {
  // 1. Run analysis pipeline
  const report = runAnalysisPipeline(dataset, datasetName, datasetType);
  expect(report.descriptive.length).toBeGreaterThan(0);
  expect(report.correlation.pairs.length).toBeGreaterThan(0);

  // 2. Generate HTML report
  const metadata: DatasetMetadata = {
    columns: dataset.columns,
    columnTypes: dataset.types,
    rowCount: dataset.rows.length,
    datasetName,
  };
  const config: MedicalAgentConfig = {
    did: "did:hcs:0.0.1234:5",
    accountId: "0.0.1234",
    privateKey: "302e0201000a",
    tier: "gold",
    capabilities: ["medical-analysis"],
  };
  const html = generateHtmlLayout(report, metadata, config);
  expect(html).toContain("<html");
  expect(html.length).toBeLessThan(500_000); // ≤500KB

  // 3. Generate JSON report
  const task: TaskInfo = {
    taskId: `test-${datasetType}`,
    datasetUrn: `urn:li:dataset:(urn:li:dataPlatform:test,${datasetType},PROD)`,
    analysisType: "descriptive",
  };
  const jsonStr = generateJsonReport(report, metadata, config, task);
  expect(jsonStr).toContain(`"taskId":"test-${datasetType}"`);

  // 4. Validate JSON report
  const validation = validateJsonReport(jsonStr, TEMPLATE);
  expect(validation).toBeDefined();

  // 5. Self-correcting loop (mock verify that passes on 1st attempt)
  return runSelfCorrectingLoop({
    taskId: `test-${datasetType}`,
    report,
    template: TEMPLATE,
    verify: async () => ({ passed: true, checks: [], failedChecks: [] }),
    completeTask: async () => true,
    maxAttempts: 3,
  });
}

describe("Integration: Full lifecycle — Pima Diabetes", () => {
  it("runs full pipeline: analyze → report → verify → complete", async () => {
    const dataset = mockPimaDataset(10);
    const result = await runFullLifecycle("Pima Indians Diabetes", "pima", dataset);
    expect(result.completed).toBe(true);
    expect(result.attempts).toBe(1);
  });
});

describe("Integration: Full lifecycle — Heart Disease", () => {
  it("runs full pipeline: analyze → report → verify → complete", async () => {
    const dataset = mockHeartDataset(10);
    const result = await runFullLifecycle("Heart Disease", "cardiac", dataset);
    expect(result.completed).toBe(true);
    expect(result.attempts).toBe(1);
  });
});

describe("Integration: Full lifecycle — Breast Cancer", () => {
  it("runs full pipeline: analyze → report → verify → complete", async () => {
    const dataset = mockBreastCancerDataset(10);
    const result = await runFullLifecycle("Breast Cancer", "cancer", dataset);
    expect(result.completed).toBe(true);
    expect(result.attempts).toBe(1);
  });
});
