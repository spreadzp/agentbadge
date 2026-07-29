import { describe, it, expect } from "vitest";
import { generateRandomMedicalData, getMedicalDataById, getAllSamples } from "../src/server/services/medical-data.service";
import { analyzeMedicalData } from "../src/server/services/medical-processor.service";
import type { MedicalData } from "../src/server/services/medical-data.service";

describe("SLICE-11-1: Medical Data Generator", () => {
  it("generates valid MedicalData with all required fields", () => {
    const data = generateRandomMedicalData();
    expect(data.patientId).toMatch(/^P\d{3}$/);
    expect(data.patientName).toBeTruthy();
    expect(data.age).toBeGreaterThanOrEqual(18);
    expect(data.age).toBeLessThanOrEqual(80);
    expect(["M", "F"]).toContain(data.gender);
    expect(data.vitalSigns.heartRate).toBeGreaterThanOrEqual(60);
    expect(data.vitalSigns.heartRate).toBeLessThanOrEqual(100);
    expect(data.vitalSigns.bloodPressure).toMatch(/^\d+\/\d+$/);
    expect(data.vitalSigns.temperature).toBeGreaterThanOrEqual(36.5);
    expect(data.vitalSigns.temperature).toBeLessThanOrEqual(37.5);
    expect(data.vitalSigns.oxygenSaturation).toBeGreaterThanOrEqual(95);
    expect(data.labResults.glucose).toBeGreaterThanOrEqual(70);
    expect(data.labResults.cholesterol).toBeGreaterThanOrEqual(150);
    expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("produces different data on multiple calls", () => {
    const data1 = generateRandomMedicalData();
    const data2 = generateRandomMedicalData();
    expect(data1).not.toEqual(data2);
  });

  it("returns sample by ID", () => {
    const sample = getMedicalDataById("P001");
    expect(sample).toBeDefined();
    expect(sample!.patientId).toBe("P001");
    expect(sample!.patientName).toBe("John Doe");
  });

  it("returns undefined for unknown ID", () => {
    expect(getMedicalDataById("P999")).toBeUndefined();
  });

  it("returns all samples", () => {
    const samples = getAllSamples();
    expect(samples.length).toBeGreaterThanOrEqual(3);
  });
});

describe("SLICE-11-2: Medical Data Processor", () => {
  it("analyzes normal data as low risk", () => {
    const normalData: MedicalData = {
      patientId: "P003",
      patientName: "Bob Johnson",
      age: 30,
      gender: "M",
      vitalSigns: {
        heartRate: 65,
        bloodPressure: "110/75",
        temperature: 36.8,
        respiratoryRate: 14,
        oxygenSaturation: 99,
      },
      labResults: {
        glucose: 85,
        cholesterol: 165,
        hemoglobin: 15.8,
        whiteBloodCells: 6.1,
        platelets: 300,
      },
      symptoms: [],
      medicalHistory: ["none"],
      timestamp: "2026-07-24T11:15:00Z",
    };
    const result = analyzeMedicalData(normalData);
    expect(result.riskLevel).toBe("low");
    expect(result.abnormalFindings).toHaveLength(0);
    expect(result.recommendations).toContain("Continue current lifestyle");
    expect(result.summary).toContain("normal");
  });

  it("detects high heart rate", () => {
    const data: MedicalData = {
      ...generateRandomMedicalData(),
      vitalSigns: {
        ...generateRandomMedicalData().vitalSigns,
        heartRate: 110,
      },
    };
    const result = analyzeMedicalData(data);
    expect(result.vitalSignsAnalysis.heartRateStatus).toBe("high");
    expect(result.abnormalFindings.some((f) => f.includes("Heart rate"))).toBe(true);
  });

  it("detects low glucose", () => {
    const data: MedicalData = {
      ...generateRandomMedicalData(),
      labResults: {
        ...generateRandomMedicalData().labResults,
        glucose: 60,
      },
    };
    const result = analyzeMedicalData(data);
    expect(result.labResultsAnalysis.glucoseStatus).toBe("low");
    expect(result.abnormalFindings.some((f) => f.includes("Glucose"))).toBe(true);
  });

  it("detects high blood pressure", () => {
    const data: MedicalData = {
      ...generateRandomMedicalData(),
      vitalSigns: {
        ...generateRandomMedicalData().vitalSigns,
        bloodPressure: "145/92",
      },
    };
    const result = analyzeMedicalData(data);
    expect(result.vitalSignsAnalysis.bloodPressureStatus).toBe("high");
  });

  it("calculates moderate risk for 1-2 abnormalities", () => {
    const data: MedicalData = {
      patientId: "P001",
      patientName: "Test Patient",
      age: 50,
      gender: "M",
      vitalSigns: {
        heartRate: 110,
        bloodPressure: "120/80",
        temperature: 37.0,
        respiratoryRate: 16,
        oxygenSaturation: 98,
      },
      labResults: {
        glucose: 90,
        cholesterol: 180,
        hemoglobin: 14,
        whiteBloodCells: 7,
        platelets: 250,
      },
      symptoms: [],
      medicalHistory: [],
      timestamp: new Date().toISOString(),
    };
    const result = analyzeMedicalData(data);
    expect(result.riskLevel).toBe("moderate");
    expect(result.abnormalFindings.length).toBeLessThanOrEqual(2);
  });

  it("calculates high risk for 3+ abnormalities", () => {
    const data: MedicalData = {
      patientId: "P002",
      patientName: "Jane Smith",
      age: 62,
      gender: "F",
      vitalSigns: {
        heartRate: 110,
        bloodPressure: "145/92",
        temperature: 38.0,
        respiratoryRate: 22,
        oxygenSaturation: 93,
      },
      labResults: {
        glucose: 145,
        cholesterol: 220,
        hemoglobin: 11.0,
        whiteBloodCells: 13.5,
        platelets: 180,
      },
      symptoms: ["fatigue"],
      medicalHistory: ["diabetes"],
      timestamp: new Date().toISOString(),
    };
    const result = analyzeMedicalData(data);
    expect(result.riskLevel).toBe("high");
    expect(result.abnormalFindings.length).toBeGreaterThanOrEqual(3);
    expect(result.recommendations).toContain("Urgent medical consultation recommended");
  });

  it("generates summary with patient name", () => {
    const data = getMedicalDataById("P001")!;
    const result = analyzeMedicalData(data);
    expect(result.summary).toContain("John Doe");
  });

  it("returns analysisDate as ISO string", () => {
    const data = generateRandomMedicalData();
    const result = analyzeMedicalData(data);
    expect(result.analysisDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
