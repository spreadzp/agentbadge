import { describe, it, expect } from "bun:test";
import {
  generateJsonReport,
  validateJsonReport,
  extractGlossaryTerms,
  buildSummary,
} from "../../../src/agents/report/json-report";
import { generatePimaSample } from "../../../src/agents/analysis/pima-dataset";
import { runAnalysisPipeline, buildDatasetMetadata } from "../../../src/agents/analysis/pipeline";
import type {
  AnalysisReport,
  DatasetMetadata,
  MedicalAgentConfig,
  TaskInfo,
  AssertionTemplate,
  JsonReport,
} from "../../../src/agents/types";

const CONFIG: MedicalAgentConfig = {
  did: "did:hcs:0.0.1234:5",
  accountId: "0.0.1234",
  privateKey: "",
  tier: "gold",
  capabilities: ["medical-analysis"],
};

const TASK: TaskInfo = {
  taskId: "task-abc-123",
  datasetUrn: "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)",
  analysisType: "descriptive",
};

function makeReport(): { report: AnalysisReport; metadata: DatasetMetadata } {
  const dataset = generatePimaSample();
  const report = runAnalysisPipeline(dataset, "Pima Indians Diabetes", "pima");
  const metadata = buildDatasetMetadata(dataset, "Pima Indians Diabetes");
  return { report, metadata };
}

// ─── generateJsonReport ─────────────────────────────────────────────

describe("generateJsonReport", () => {
  it("generates valid parseable JSON", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("includes taskId and agent metadata", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(parsed.taskId).toBe("task-abc-123");
    expect(parsed.agentDid).toBe("did:hcs:0.0.1234:5");
    expect(parsed.agentTier).toBe("gold");
  });

  it("includes datasetUrn and analysisType", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(parsed.datasetUrn).toBe(TASK.datasetUrn!);
    expect(parsed.analysisType).toBe("descriptive");
  });

  it("includes all descriptive stats", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(parsed.descriptive).toHaveLength(report.descriptive.length);
    expect(parsed.descriptive[0].name).toBe("pregnancies");
    expect(parsed.descriptive[0].mean).not.toBeNull();
  });

  it("includes significant correlations", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(parsed.correlations).toBeArray();
    // All correlations should have required fields
    for (const c of parsed.correlations) {
      expect(c.columnX).toBeTruthy();
      expect(c.columnY).toBeTruthy();
      expect(typeof c.coefficient).toBe("number");
      expect(typeof c.significant).toBe("boolean");
    }
  });

  it("includes risk factors with glossary terms", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(parsed.riskFactors).toBeArray();
    for (const rf of parsed.riskFactors) {
      expect(rf.factorName).toBeTruthy();
      expect(rf.severity).toMatch(/minimal|low|moderate|high/);
      expect(rf.glossaryTerms).toBeArray();
      expect(rf.glossaryTerms.length).toBeGreaterThan(0);
    }
  });

  it("glossaryTermsReferenced is unique", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    const terms = parsed.glossaryTermsReferenced;
    const unique = new Set(terms);
    expect(terms.length).toBe(unique.size);
  });

  it("includes summary string", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(typeof parsed.summary).toBe("string");
    expect(parsed.summary.length).toBeGreaterThan(10);
  });

  it("includes rowCount and datasetName", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(parsed.rowCount).toBe(metadata.rowCount);
    expect(parsed.datasetName).toBe("Pima Indians Diabetes");
  });

  it("analysisDate is ISO string", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const parsed: JsonReport = JSON.parse(json);
    expect(() => new Date(parsed.analysisDate).toISOString()).not.toThrow();
  });

  it("JSON is compact (no pretty-printing) and reasonably sized", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    // Compact JSON (no indentation) — spec says ≤4KB for HCS or IPFS for larger
    // 15-row sample with 9 columns and 36 correlations produces ~8KB compact
    expect(json).not.toContain("\n  "); // no pretty-printing indentation
    expect(json.length).toBeLessThan(10000); // reasonable for 15-row sample
  });
});

// ─── extractGlossaryTerms ───────────────────────────────────────────

describe("extractGlossaryTerms", () => {
  it("extracts unique glossary terms from risk factors", () => {
    const { report } = makeReport();
    const terms = extractGlossaryTerms(report);
    const unique = new Set(terms);
    expect(terms.length).toBe(unique.size);
  });

  it("returns empty array when no risk factors", () => {
    const report: AnalysisReport = {
      datasetName: "test",
      analysisDate: new Date().toISOString(),
      descriptive: [],
      correlation: { columns: [], matrix: [], pairs: [] },
      riskFactors: [],
    };
    const terms = extractGlossaryTerms(report);
    expect(terms).toEqual([]);
  });
});

// ─── buildSummary ───────────────────────────────────────────────────

describe("buildSummary", () => {
  it("mentions risk level", () => {
    const { report } = makeReport();
    const summary = buildSummary(report);
    expect(summary.toLowerCase()).toContain("risk");
  });

  it("mentions column count", () => {
    const { report } = makeReport();
    const summary = buildSummary(report);
    expect(summary).toContain(String(report.descriptive.length));
  });

  it("mentions correlation count", () => {
    const { report } = makeReport();
    const summary = buildSummary(report);
    expect(summary).toContain(String(report.correlation.pairs.length));
  });
});

// ─── validateJsonReport ─────────────────────────────────────────────

const GOOD_TEMPLATE: AssertionTemplate = {
  analysisType: "descriptive",
  description: "Descriptive stats assertions",
  requiredGlossaryTerms: ["glucose", "bmi"],
  assertions: [
    {
      type: "schema",
      compatibility: "SUPERSET",
      description: "Result must contain all original dataset columns",
      fields: [
        { path: "column_name", type: "STRING" },
        { path: "mean", type: "NUMBER" },
      ],
    },
    {
      type: "schema",
      description: "At least 1 significant correlation",
      minSignificantCorrelations: 1,
    },
    {
      type: "schema",
      description: "Report references at least 1 glossary term",
      minGlossaryTerms: 1,
    },
    {
      type: "schema",
      description: "Risk severity is not 'minimal'",
      severityNotMinimal: true,
    },
    {
      type: "schema",
      description: "Glucose mean between 70 and 200",
      meanRange: { column: "glucose", min: 70, max: 200 },
    },
  ],
};

describe("validateJsonReport", () => {
  it("passes when all assertions met", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const result = validateJsonReport(json, GOOD_TEMPLATE);
    // With sample data, all assertions should pass
    // (glucose mean ~136, which is in [70,200]; sample has 14 significant correlations; has 1 glossary term)
    expect(result.passed).toBe(true);
    expect(result.failedChecks).toEqual([]);
  });

  it("fails when mean out of range", () => {
    const template: AssertionTemplate = {
      ...GOOD_TEMPLATE,
      assertions: [
        {
          type: "schema",
          description: "Glucose mean between 70 and 100",
          meanRange: { column: "glucose", min: 70, max: 100 },
        },
      ],
    };
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const result = validateJsonReport(json, template);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.length).toBeGreaterThan(0);
  });

  it("fails when no significant correlations required", () => {
    const template: AssertionTemplate = {
      ...GOOD_TEMPLATE,
      assertions: [
        {
          type: "schema",
          description: "At least 20 significant correlations",
          minSignificantCorrelations: 20,
        },
      ],
    };
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const result = validateJsonReport(json, template);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.length).toBeGreaterThan(0);
  });

  it("fails when not enough glossary terms", () => {
    const template: AssertionTemplate = {
      ...GOOD_TEMPLATE,
      assertions: [
        {
          type: "schema",
          description: "Report references at least 10 glossary terms",
          minGlossaryTerms: 10,
        },
      ],
    };
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const result = validateJsonReport(json, template);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.length).toBeGreaterThan(0);
  });

  it("returns per-assertion results", () => {
    const { report, metadata } = makeReport();
    const json = generateJsonReport(report, metadata, CONFIG, TASK);
    const result = validateJsonReport(json, GOOD_TEMPLATE);
    expect(result.checks.length).toBe(GOOD_TEMPLATE.assertions.length);
    for (const check of result.checks) {
      expect(typeof check.description).toBe("string");
      expect(typeof check.passed).toBe("boolean");
      expect(typeof check.message).toBe("string");
    }
  });

  it("handles invalid JSON gracefully", () => {
    const result = validateJsonReport("not valid json", GOOD_TEMPLATE);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.length).toBeGreaterThan(0);
  });
});
