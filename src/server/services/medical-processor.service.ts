import type { MedicalData } from "./medical-data.service";

export interface VitalSignsAnalysis {
  heartRateStatus: "normal" | "low" | "high";
  bloodPressureStatus: "normal" | "low" | "high";
  temperatureStatus: "normal" | "low" | "high";
  oxygenStatus: "normal" | "low";
}

export interface LabResultsAnalysis {
  glucoseStatus: "normal" | "low" | "high";
  cholesterolStatus: "normal" | "high";
  hemoglobinStatus: "normal" | "low" | "high";
  whiteBloodCellsStatus: "normal" | "low" | "high";
  plateletStatus: "normal" | "low" | "high";
}

export interface AnalysisResult {
  patientId: string;
  analysisDate: string;
  vitalSignsAnalysis: VitalSignsAnalysis;
  labResultsAnalysis: LabResultsAnalysis;
  riskLevel: "low" | "moderate" | "high";
  abnormalFindings: string[];
  recommendations: string[];
  summary: string;
}

function analyzeVitalSigns(vitals: MedicalData["vitalSigns"]): VitalSignsAnalysis {
  return {
    heartRateStatus: vitals.heartRate < 60 ? "low" : vitals.heartRate > 100 ? "high" : "normal",
    bloodPressureStatus: analyzeBP(vitals.bloodPressure),
    temperatureStatus: vitals.temperature < 36.5 ? "low" : vitals.temperature > 37.5 ? "high" : "normal",
    oxygenStatus: vitals.oxygenSaturation < 95 ? "low" : "normal",
  };
}

function analyzeBP(bp: string): "normal" | "low" | "high" {
  const [systolic, diastolic] = bp.split("/").map(Number);
  if (systolic < 90 || diastolic < 60) return "low";
  if (systolic > 140 || diastolic > 90) return "high";
  return "normal";
}

function analyzeLabResults(labs: MedicalData["labResults"]): LabResultsAnalysis {
  return {
    glucoseStatus: labs.glucose < 70 ? "low" : labs.glucose > 120 ? "high" : "normal",
    cholesterolStatus: labs.cholesterol > 200 ? "high" : "normal",
    hemoglobinStatus: labs.hemoglobin < 12 ? "low" : labs.hemoglobin > 17 ? "high" : "normal",
    whiteBloodCellsStatus: labs.whiteBloodCells < 4.5 ? "low" : labs.whiteBloodCells > 11 ? "high" : "normal",
    plateletStatus: labs.platelets < 150 ? "low" : labs.platelets > 400 ? "high" : "normal",
  };
}

function findAbnormalities(vitals: VitalSignsAnalysis, labs: LabResultsAnalysis): string[] {
  const findings: string[] = [];
  const vitalsMap: Record<string, string> = {
    heartRateStatus: "Heart rate",
    bloodPressureStatus: "Blood pressure",
    temperatureStatus: "Temperature",
    oxygenStatus: "Oxygen saturation",
  };
  const labsMap: Record<string, string> = {
    glucoseStatus: "Glucose",
    cholesterolStatus: "Cholesterol",
    hemoglobinStatus: "Hemoglobin",
    whiteBloodCellsStatus: "White blood cells",
    plateletStatus: "Platelets",
  };
  for (const [key, status] of Object.entries(vitals)) {
    if (status !== "normal") findings.push(`${vitalsMap[key]}: ${status}`);
  }
  for (const [key, status] of Object.entries(labs)) {
    if (status !== "normal") findings.push(`${labsMap[key]}: ${status}`);
  }
  return findings;
}

function calculateRiskLevel(findings: string[]): "low" | "moderate" | "high" {
  if (findings.length === 0) return "low";
  if (findings.length <= 2) return "moderate";
  return "high";
}

function generateRecommendations(riskLevel: "low" | "moderate" | "high"): string[] {
  if (riskLevel === "low") {
    return ["Continue current lifestyle", "Regular checkups recommended"];
  }
  if (riskLevel === "moderate") {
    return ["Monitor vital signs regularly", "Consider lifestyle modifications", "Follow-up appointment in 2-4 weeks"];
  }
  return ["Urgent medical consultation recommended", "Monitor vital signs daily", "Seek immediate medical attention if symptoms worsen"];
}

function generateSummary(patientName: string, riskLevel: "low" | "moderate" | "high", findings: string[]): string {
  if (riskLevel === "low") {
    return `Patient ${patientName} shows normal vital signs and lab results. No immediate concerns.`;
  }
  if (riskLevel === "moderate") {
    return `Patient ${patientName} shows some abnormal findings: ${findings.join(", ")}. Monitoring recommended.`;
  }
  return `Patient ${patientName} shows significant abnormal findings: ${findings.join(", ")}. Urgent evaluation needed.`;
}

export function analyzeMedicalData(data: MedicalData): AnalysisResult {
  const vitalSignsAnalysis = analyzeVitalSigns(data.vitalSigns);
  const labResultsAnalysis = analyzeLabResults(data.labResults);
  const abnormalFindings = findAbnormalities(vitalSignsAnalysis, labResultsAnalysis);
  const riskLevel = calculateRiskLevel(abnormalFindings);
  const recommendations = generateRecommendations(riskLevel);
  const summary = generateSummary(data.patientName, riskLevel, abnormalFindings);

  return {
    patientId: data.patientId,
    analysisDate: new Date().toISOString(),
    vitalSignsAnalysis,
    labResultsAnalysis,
    riskLevel,
    abnormalFindings,
    recommendations,
    summary,
  };
}
