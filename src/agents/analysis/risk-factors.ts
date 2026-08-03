import type { TypedDataset, ColumnSummary, RiskFactorResult, RiskFactorContributingFactor } from "../types";

interface RiskModel {
  factorName: string;
  threshold: number;
  metrics: {
    columnName: string;
    metricLabel: string;
    threshold: number;
    points: number;
    glossaryTerm: string;
  }[];
}

const RISK_MODELS: Record<string, RiskModel> = {
  pima: {
    factorName: "Diabetes Risk",
    threshold: 5,
    metrics: [
      { columnName: "glucose", metricLabel: "Glucose", threshold: 126, points: 2, glossaryTerm: "urn:li:glossaryTerm:Glucose" },
      { columnName: "bmi", metricLabel: "BMI", threshold: 30, points: 2, glossaryTerm: "urn:li:glossaryTerm:BMI" },
      { columnName: "age", metricLabel: "Age", threshold: 45, points: 1, glossaryTerm: "urn:li:glossaryTerm:Age" },
    ],
  },
  cardiac: {
    factorName: "Cardiac Risk",
    threshold: 4,
    metrics: [
      { columnName: "age", metricLabel: "Age", threshold: 55, points: 2, glossaryTerm: "urn:li:glossaryTerm:Age" },
      { columnName: "bloodPressure", metricLabel: "Blood Pressure", threshold: 140, points: 2, glossaryTerm: "urn:li:glossaryTerm:BloodPressure" },
      { columnName: "bmi", metricLabel: "BMI", threshold: 30, points: 1, glossaryTerm: "urn:li:glossaryTerm:BMI" },
    ],
  },
  cancer: {
    factorName: "Cancer Risk",
    threshold: 3,
    metrics: [
      { columnName: "age", metricLabel: "Age", threshold: 50, points: 2, glossaryTerm: "urn:li:glossaryTerm:Age" },
      { columnName: "bmi", metricLabel: "BMI", threshold: 35, points: 1, glossaryTerm: "urn:li:glossaryTerm:BMI" },
    ],
  },
};

function severityFor(score: number, threshold: number): "minimal" | "low" | "moderate" | "high" {
  if (score === 0) return "minimal";
  if (score < threshold * 0.5) return "low";
  if (score < threshold) return "moderate";
  return "high";
}

export function computeRiskFactors(
  dataset: TypedDataset,
  stats: ColumnSummary[],
  datasetType: string
): RiskFactorResult[] {
  const model = RISK_MODELS[datasetType];
  if (!model) return [];

  const statsMap = new Map(stats.map((s) => [s.name, s]));
  const contributingFactors: RiskFactorContributingFactor[] = [];
  let score = 0;

  for (const metric of model.metrics) {
    const colStat = statsMap.get(metric.columnName);
    if (!colStat || colStat.mean === null) continue;

    const value = colStat.mean;
    if (value >= metric.threshold) {
      score += metric.points;
      contributingFactors.push({
        metric: metric.metricLabel,
        value,
        threshold: metric.threshold,
        points: metric.points,
        glossaryTerm: metric.glossaryTerm,
      });
    }
  }

  const glossaryTerms = contributingFactors.map((f) => f.glossaryTerm);

  return [
    {
      factorName: model.factorName,
      datasetType,
      score,
      severity: severityFor(score, model.threshold),
      threshold: model.threshold,
      contributingFactors,
      glossaryTerms,
    },
  ];
}
