import { describe, it, expect } from "vitest";
import {
  generateHtmlLayout,
  barChartSvg,
  heatmapSvg,
  scatterPlotSvg,
  riskBadgeSvg,
} from "../../../src/agents/report/html-layout";
import type {
  AnalysisReport,
  DatasetMetadata,
  MedicalAgentConfig,
  BarChartData,
  CorrelationMatrix,
  ScatterPoint,
} from "../../../src/agents/types";

const mockConfig: MedicalAgentConfig = {
  did: "did:hcs:0.0.1234:5",
  accountId: "0.0.1234",
  privateKey: "0xdeadbeef",
  tier: "gold",
  capabilities: ["data_provide"],
};

const mockMetadata: DatasetMetadata = {
  columns: ["pregnancies", "glucose", "bloodPressure", "bmi", "age", "outcome"],
  columnTypes: ["number", "number", "number", "number", "number", "number"],
  rowCount: 768,
  datasetName: "Pima Indians Diabetes",
};

const mockReport: AnalysisReport = {
  datasetName: "Pima Indians Diabetes",
  analysisDate: "2026-08-03T11:00:00Z",
  descriptive: [
    { name: "pregnancies", type: "number", count: 768, nullCount: 0, uniqueCount: 17, mean: 3.85, median: 3, stdDev: 3.37, min: 0, max: 17, q1: 1, q3: 6, iqr: 5 },
    { name: "glucose", type: "number", count: 768, nullCount: 5, uniqueCount: 136, mean: 121.7, median: 117, stdDev: 30.5, min: 0, max: 199, q1: 99, q3: 140, iqr: 41 },
    { name: "bloodPressure", type: "number", count: 768, nullCount: 35, uniqueCount: 47, mean: 72.4, median: 72, stdDev: 12.1, min: 0, max: 122, q1: 64, q3: 80, iqr: 16 },
    { name: "bmi", type: "number", count: 768, nullCount: 11, uniqueCount: 248, mean: 32.5, median: 32.3, stdDev: 6.9, min: 0, max: 67.1, q1: 27.5, q3: 36.1, iqr: 8.6 },
    { name: "age", type: "number", count: 768, nullCount: 0, uniqueCount: 52, mean: 33.2, median: 29, stdDev: 11.8, min: 21, max: 81, q1: 25, q3: 41, iqr: 16 },
    { name: "outcome", type: "number", count: 768, nullCount: 0, uniqueCount: 2, mean: 0.35, median: 0, stdDev: 0.48, min: 0, max: 1, q1: 0, q3: 1, iqr: 1 },
  ],
  correlation: {
    columns: ["pregnancies", "glucose", "bmi", "age"],
    matrix: [
      [1.0, 0.13, 0.02, 0.54],
      [0.13, 1.0, 0.22, 0.27],
      [0.02, 0.22, 1.0, 0.04],
      [0.54, 0.27, 0.04, 1.0],
    ],
    pairs: [
      { columnX: "age", columnY: "pregnancies", coefficient: 0.54, pValue: 0.001, significant: true, strength: "moderate", direction: "positive" },
      { columnX: "glucose", columnY: "bmi", coefficient: 0.22, pValue: 0.03, significant: true, strength: "weak", direction: "positive" },
    ],
  },
  riskFactors: [
    {
      factorName: "Diabetes Risk",
      datasetType: "pima",
      score: 5,
      severity: "high",
      threshold: 5,
      contributingFactors: [
        { metric: "Glucose", value: 121.7, threshold: 126, points: 2, glossaryTerm: "urn:li:glossaryTerm:Glucose" },
        { metric: "BMI", value: 32.5, threshold: 30, points: 2, glossaryTerm: "urn:li:glossaryTerm:BMI" },
        { metric: "Age", value: 33.2, threshold: 45, points: 1, glossaryTerm: "urn:li:glossaryTerm:Age" },
      ],
      glossaryTerms: ["urn:li:glossaryTerm:Glucose", "urn:li:glossaryTerm:BMI", "urn:li:glossaryTerm:Age"],
    },
  ],
};

describe("SLICE-26-7: HTML Layout & Charts", () => {
  describe("generateHtmlLayout", () => {
    const html = generateHtmlLayout(mockReport, mockMetadata, mockConfig);

    it("generates valid HTML5 with DOCTYPE", () => {
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    it("has <head> and <body>", () => {
      expect(html).toContain("<head>");
      expect(html).toContain("</head>");
      expect(html).toContain("<body>");
      expect(html).toContain("</body>");
    });

    it("includes dataset name in title", () => {
      expect(html).toContain("Pima Indians Diabetes");
    });

    it("includes agent DID in footer", () => {
      expect(html).toContain("did:hcs:0.0.1234:5");
    });

    it("includes executive summary with risk level badge", () => {
      expect(html).toContain("Diabetes Risk");
      expect(html).toContain("high");
    });

    it("includes descriptive statistics table", () => {
      expect(html).toContain("pregnancies");
      expect(html).toContain("mean");
      expect(html).toContain("median");
      expect(html).toContain("stdDev");
    });

    it("includes correlation heatmap SVG", () => {
      expect(html).toContain("<svg");
      expect(html).toContain("heatmap");
    });

    it("includes bar chart SVG", () => {
      expect(html).toContain("bar");
    });

    it("includes scatter plot SVG", () => {
      expect(html).toContain("scatter");
    });

    it("has no external resources (all inline)", () => {
      expect(html).not.toMatch(/<link\s/i);
      expect(html).not.toMatch(/<script\s+src=/i);
      expect(html).not.toMatch(/url\(https?:\/\//i);
    });

    it("has inline <style> block", () => {
      expect(html).toContain("<style>");
      expect(html).toContain("</style>");
    });

    it("total size ≤500KB", () => {
      expect(Buffer.byteLength(html, "utf-8")).toBeLessThanOrEqual(500 * 1024);
    });

    it("includes print-friendly CSS", () => {
      expect(html).toContain("@media print");
    });
  });

  describe("barChartSvg", () => {
    const data: BarChartData = {
      labels: ["A", "B", "C", "D"],
      values: [10, 25, 15, 30],
      title: "Test Chart",
    };
    const svg = barChartSvg(data);

    it("generates valid SVG", () => {
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain("http://www.w3.org/2000/svg");
    });

    it("has correct number of bars", () => {
      const rectCount = (svg.match(/<rect/g) || []).length;
      expect(rectCount).toBe(4);
    });

    it("labels match column names", () => {
      expect(svg).toContain("A");
      expect(svg).toContain("B");
      expect(svg).toContain("C");
      expect(svg).toContain("D");
    });
  });

  describe("heatmapSvg", () => {
    const matrix: CorrelationMatrix = {
      columns: ["x", "y", "z"],
      matrix: [
        [1.0, 0.5, -0.3],
        [0.5, 1.0, 0.1],
        [-0.3, 0.1, 1.0],
      ],
      pairs: [],
    };
    const svg = heatmapSvg(matrix);

    it("generates valid SVG", () => {
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
    });

    it("has n×n cells (3×3 = 9)", () => {
      const rectCount = (svg.match(/<rect/g) || []).length;
      expect(rectCount).toBe(9);
    });

    it("contains r values as text", () => {
      expect(svg).toContain("1.00");
      expect(svg).toContain("0.50");
      expect(svg).toContain("-0.30");
    });

    it("uses red for positive, blue for negative", () => {
      // Positive correlation should have warm color (red-ish)
      expect(svg).toContain("#ef4444");
      // Negative correlation should have cool color (blue-ish)
      expect(svg).toContain("#3b82f6");
    });
  });

  describe("scatterPlotSvg", () => {
    const points: ScatterPoint[] = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
      { x: 7, y: 8 },
    ];
    const svg = scatterPlotSvg(points, "Age", "Glucose");

    it("generates valid SVG", () => {
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
    });

    it("has correct point count (circles)", () => {
      const circleCount = (svg.match(/<circle/g) || []).length;
      expect(circleCount).toBe(4);
    });

    it("axis labels present", () => {
      expect(svg).toContain("Age");
      expect(svg).toContain("Glucose");
    });
  });

  describe("riskBadgeSvg", () => {
    it("green for minimal", () => {
      const svg = riskBadgeSvg("minimal");
      expect(svg).toContain("#10b981");
    });

    it("yellow for low", () => {
      const svg = riskBadgeSvg("low");
      expect(svg).toContain("#eab308");
    });

    it("orange for moderate", () => {
      const svg = riskBadgeSvg("moderate");
      expect(svg).toContain("#f59e0b");
    });

    it("red for high", () => {
      const svg = riskBadgeSvg("high");
      expect(svg).toContain("#ef4444");
    });
  });
});
