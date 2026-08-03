import type {
  AnalysisReport,
  DatasetMetadata,
  MedicalAgentConfig,
  TaskInfo,
  JsonReport,
  AssertionTemplate,
  ValidationResult,
  AssertionCheckResult,
  RiskFactorResult,
} from "../types";

/**
 * Extract all unique glossary terms referenced in the report's risk factors.
 */
export function extractGlossaryTerms(report: AnalysisReport): string[] {
  const terms = new Set<string>();
  for (const rf of report.riskFactors) {
    for (const term of rf.glossaryTerms) {
      terms.add(term);
    }
    for (const cf of rf.contributingFactors) {
      if (cf.glossaryTerm) terms.add(cf.glossaryTerm);
    }
  }
  return Array.from(terms);
}

/**
 * Build a human-readable summary of the analysis.
 */
export function buildSummary(report: AnalysisReport): string {
  const colCount = report.descriptive.length;
  const corrCount = report.correlation.pairs.length;
  const sigCount = report.correlation.pairs.filter((p) => p.significant).length;
  const riskCount = report.riskFactors.length;

  const riskParts = report.riskFactors.map((rf) => {
    return `${rf.factorName}: ${rf.severity.toUpperCase()} (score ${rf.score}/${rf.threshold})`;
  });

  const riskStr = riskParts.length > 0 ? riskParts.join("; ") : "no risk factors identified";

  return `Dataset "${report.datasetName}" with ${colCount} columns analyzed. Found ${corrCount} correlation pair(s) (${sigCount} significant) and ${riskCount} risk factor(s): ${riskStr}.`;
}

/**
 * Generate a structured JSON report for DataHub verifier consumption.
 * Returns a JSON string.
 */
export function generateJsonReport(
  report: AnalysisReport,
  metadata: DatasetMetadata,
  config: MedicalAgentConfig,
  task: TaskInfo,
): string {
  const correlations = report.correlation.pairs;
  const glossaryTermsReferenced = extractGlossaryTerms(report);
  const summary = buildSummary(report);

  const jsonReport: JsonReport = {
    taskId: task.taskId,
    agentDid: config.did,
    agentTier: config.tier,
    analysisDate: report.analysisDate,
    datasetUrn: task.datasetUrn ?? `urn:li:dataset:(urn:li:dataPlatform:local,${metadata.datasetName},PROD)`,
    analysisType: task.analysisType,
    datasetName: metadata.datasetName,
    rowCount: metadata.rowCount,
    descriptive: report.descriptive,
    correlations,
    riskFactors: report.riskFactors,
    glossaryTermsReferenced,
    summary,
  };

  return JSON.stringify(jsonReport);
}

/**
 * Validate a JSON report against assertion templates.
 */
export function validateJsonReport(
  json: string,
  template: AssertionTemplate,
): ValidationResult {
  let parsed: JsonReport;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      passed: false,
      checks: [],
      failedChecks: ["JSON is not parseable"],
    };
  }

  const checks: AssertionCheckResult[] = [];

  for (const assertion of template.assertions) {
    const result = checkAssertion(parsed, assertion);
    checks.push(result);
  }

  const failedChecks = checks.filter((c) => !c.passed).map((c) => c.description);

  return {
    passed: failedChecks.length === 0,
    checks,
    failedChecks,
  };
}

function checkAssertion(
  report: JsonReport,
  assertion: AssertionTemplate["assertions"][number],
): AssertionCheckResult {
  const desc = assertion.description;

  // Check: minSignificantCorrelations
  if (assertion.minSignificantCorrelations !== undefined) {
    const sigCount = report.correlations.filter((c) => c.significant).length;
    if (sigCount >= assertion.minSignificantCorrelations) {
      return { description: desc, passed: true, message: `Found ${sigCount} significant correlation(s)` };
    }
    return {
      description: desc,
      passed: false,
      message: `Only ${sigCount} significant correlation(s), need ≥${assertion.minSignificantCorrelations}`,
    };
  }

  // Check: minGlossaryTerms
  if (assertion.minGlossaryTerms !== undefined) {
    const termCount = report.glossaryTermsReferenced.length;
    if (termCount >= assertion.minGlossaryTerms) {
      return { description: desc, passed: true, message: `Found ${termCount} glossary term(s)` };
    }
    return {
      description: desc,
      passed: false,
      message: `Only ${termCount} glossary term(s), need ≥${assertion.minGlossaryTerms}`,
    };
  }

  // Check: severityNotMinimal
  if (assertion.severityNotMinimal !== undefined) {
    const allNotMinimal = report.riskFactors.every((rf) => rf.severity !== "minimal");
    if (allNotMinimal) {
      return { description: desc, passed: true, message: "All risk factors have severity above 'minimal'" };
    }
    return {
      description: desc,
      passed: false,
      message: "At least one risk factor has severity 'minimal'",
    };
  }

  // Check: meanRange
  if (assertion.meanRange !== undefined) {
    const col = report.descriptive.find(
      (d) => d.name.toLowerCase() === assertion.meanRange!.column.toLowerCase(),
    );
    if (!col || col.mean === null) {
      return { description: desc, passed: false, message: `Column '${assertion.meanRange.column}' not found or mean is null` };
    }
    const { min, max } = assertion.meanRange;
    if (col.mean >= min && col.mean <= max) {
      return { description: desc, passed: true, message: `${assertion.meanRange.column} mean ${col.mean.toFixed(2)} is within [${min}, ${max}]` };
    }
    return {
      description: desc,
      passed: false,
      message: `${assertion.meanRange.column} mean ${col.mean.toFixed(2)} is outside [${min}, ${max}]`,
    };
  }

  // Check: schema fields present
  if (assertion.type === "schema" && assertion.fields) {
    const missing: string[] = [];
    for (const field of assertion.fields) {
      // Check if field exists in descriptive entries
      if (field.path === "column_name") {
        const allHave = report.descriptive.every((d) => d.name !== undefined);
        if (!allHave) missing.push("column_name");
      } else if (field.path === "mean") {
        const allHave = report.descriptive.every((d) => d.mean !== undefined);
        if (!allHave) missing.push("mean");
      } else if (field.path === "median") {
        const allHave = report.descriptive.every((d) => d.median !== undefined);
        if (!allHave) missing.push("median");
      } else if (field.path === "std") {
        const allHave = report.descriptive.every((d) => d.stdDev !== undefined);
        if (!allHave) missing.push("std");
      } else if (field.path === "min") {
        const allHave = report.descriptive.every((d) => d.min !== undefined);
        if (!allHave) missing.push("min");
      } else if (field.path === "max") {
        const allHave = report.descriptive.every((d) => d.max !== undefined);
        if (!allHave) missing.push("max");
      } else if (field.path === "feature_a") {
        const allHave = report.correlations.every((c) => c.columnX !== undefined);
        if (!allHave) missing.push("feature_a");
      } else if (field.path === "feature_b") {
        const allHave = report.correlations.every((c) => c.columnY !== undefined);
        if (!allHave) missing.push("feature_b");
      } else if (field.path === "correlation") {
        const allHave = report.correlations.every((c) => c.coefficient !== undefined);
        if (!allHave) missing.push("correlation");
      } else if (field.path === "p_value") {
        const allHave = report.correlations.every((c) => c.pValue !== undefined);
        if (!allHave) missing.push("p_value");
      } else if (field.path === "risk_factor") {
        const allHave = report.riskFactors.every((rf) => rf.factorName !== undefined);
        if (!allHave) missing.push("risk_factor");
      } else if (field.path === "glossary_term") {
        const allHave = report.riskFactors.every((rf) => rf.glossaryTerms.length > 0);
        if (!allHave) missing.push("glossary_term");
      }
    }

    if (missing.length === 0) {
      return { description: desc, passed: true, message: "All schema fields present" };
    }
    return { description: desc, passed: false, message: `Missing fields: ${missing.join(", ")}` };
  }

  // Default: pass if no specific check matched
  return { description: desc, passed: true, message: "No specific check defined" };
}
