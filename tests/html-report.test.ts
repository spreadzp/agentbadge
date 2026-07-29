import { describe, it, expect } from "vitest";
import { generateHtmlReport } from "../src/server/services/html-report.service";
import { generateRandomMedicalData } from "../src/server/services/medical-data.service";
import { analyzeMedicalData } from "../src/server/services/medical-processor.service";
import type { MedicalData } from "../src/server/services/medical-data.service";
import type { AnalysisResult } from "../src/server/services/medical-processor.service";

const mockData: MedicalData = {
  patientId: "P001",
  patientName: "John Doe",
  age: 45,
  gender: "M",
  vitalSigns: {
    heartRate: 78,
    bloodPressure: "145/92",
    temperature: 37.1,
    respiratoryRate: 16,
    oxygenSaturation: 98,
  },
  labResults: {
    glucose: 156,
    cholesterol: 210,
    hemoglobin: 14.2,
    whiteBloodCells: 6.5,
    platelets: 250,
  },
  symptoms: ["fatigue", "headache"],
  medicalHistory: ["hypertension"],
  timestamp: new Date().toISOString(),
};

const mockAnalysis: AnalysisResult = {
  patientId: "P001",
  analysisDate: new Date().toISOString(),
  vitalSignsAnalysis: {
    heartRateStatus: "normal",
    bloodPressureStatus: "high",
    temperatureStatus: "normal",
    oxygenStatus: "normal",
  },
  labResultsAnalysis: {
    glucoseStatus: "high",
    cholesterolStatus: "high",
    hemoglobinStatus: "normal",
    whiteBloodCellsStatus: "normal",
    plateletStatus: "normal",
  },
  riskLevel: "moderate",
  abnormalFindings: ["High blood pressure", "Elevated glucose"],
  recommendations: ["Monitor blood pressure", "Reduce sugar intake"],
  summary: "Patient shows moderate risk factors.",
};

describe("SLICE-11-3: HTML Report Generator", () => {
  it("generates a valid HTML document", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("includes patient information", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("P001");
    expect(html).toContain("John Doe");
    expect(html).toContain("45");
    expect(html).toContain("M");
  });

  it("includes risk badge with correct level", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("MODERATE RISK");
  });

  it("includes vital signs table", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("Blood Pressure");
    expect(html).toContain("145/92");
    expect(html).toContain("Heart Rate");
    expect(html).toContain("78");
    expect(html).toContain("Oxygen Saturation");
    expect(html).toContain("98");
  });

  it("includes lab results table", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("Glucose");
    expect(html).toContain("156");
    expect(html).toContain("Cholesterol");
    expect(html).toContain("210");
    expect(html).toContain("Hemoglobin");
    expect(html).toContain("14.2");
  });

  it("includes SVG charts", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("<svg");
    expect(html).toContain("</svg>");
  });

  it("includes abnormal findings when present", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("Abnormal Findings");
    expect(html).toContain("High blood pressure");
    expect(html).toContain("Elevated glucose");
  });

  it("includes recommendations", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("Clinical Recommendations");
    expect(html).toContain("Monitor blood pressure");
    expect(html).toContain("Reduce sugar intake");
  });

  it("includes symptoms section when present", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("Reported Symptoms");
    expect(html).toContain("fatigue");
    expect(html).toContain("headache");
  });

  it("includes summary", () => {
    const html = generateHtmlReport(mockData, mockAnalysis);
    expect(html).toContain("Patient shows moderate risk factors.");
  });

  it("hides findings section when no abnormal findings", () => {
    const noFindings = { ...mockAnalysis, abnormalFindings: [] };
    const html = generateHtmlReport(mockData, noFindings);
    expect(html).not.toContain("Abnormal Findings");
  });

  it("uses correct risk colors for high risk", () => {
    const highRisk = { ...mockAnalysis, riskLevel: "high" as const };
    const html = generateHtmlReport(mockData, highRisk);
    expect(html).toContain("HIGH RISK");
    expect(html).toContain("#ef4444");
  });

  it("uses correct risk colors for low risk", () => {
    const lowRisk = { ...mockAnalysis, riskLevel: "low" as const };
    const html = generateHtmlReport(mockData, lowRisk);
    expect(html).toContain("LOW RISK");
    expect(html).toContain("#10b981");
  });

  it("works with generateRandomMedicalData + analyzeMedicalData pipeline", () => {
    const data = generateRandomMedicalData();
    const analysis = analyzeMedicalData(data);
    const html = generateHtmlReport(data, analysis);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain(data.patientId);
    expect(html).toContain(analysis.riskLevel.toUpperCase());
  });
});
