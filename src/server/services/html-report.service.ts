import type { MedicalData } from "./medical-data.service";
import type { AnalysisResult } from "./medical-processor.service";

type RiskLevel = AnalysisResult["riskLevel"];

const RISK_COLORS: Record<RiskLevel, { bg: string; badge: string; border: string }> = {
  low: { bg: "#ecfdf5", badge: "#10b981", border: "#10b981" },
  moderate: { bg: "#fffbeb", badge: "#f59e0b", border: "#f59e0b" },
  high: { bg: "#fef2f2", badge: "#ef4444", border: "#ef4444" },
};

type StatusLevel = "normal" | "warning" | "critical";

const STATUS_COLORS: Record<StatusLevel, string> = {
  normal: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
};

function parseBp(bp: string): number {
  return parseInt(bp.split("/")[0], 10);
}

function getBpStatus(bp: string): StatusLevel {
  const sys = parseBp(bp);
  if (sys > 140) return "critical";
  if (sys > 120) return "warning";
  return "normal";
}

function getHeartRateStatus(hr: number): StatusLevel {
  if (hr > 120 || hr < 50) return "critical";
  if (hr > 100 || hr < 60) return "warning";
  return "normal";
}

function getTempStatus(temp: number): StatusLevel {
  if (temp > 38.5 || temp < 35.0) return "critical";
  if (temp > 37.5 || temp < 36.0) return "warning";
  return "normal";
}

function getRespStatus(rr: number): StatusLevel {
  if (rr > 25 || rr < 8) return "critical";
  if (rr > 20 || rr < 12) return "warning";
  return "normal";
}

function getOxygenStatus(o2: number): StatusLevel {
  if (o2 < 90) return "critical";
  if (o2 < 95) return "warning";
  return "normal";
}

function getGlucoseStatus(glucose: number): StatusLevel {
  if (glucose > 126) return "critical";
  if (glucose > 100) return "warning";
  return "normal";
}

function getCholesterolStatus(chol: number): StatusLevel {
  if (chol > 240) return "critical";
  if (chol > 200) return "warning";
  return "normal";
}

function getHemoglobinStatus(hb: number): StatusLevel {
  if (hb < 10 || hb > 18) return "critical";
  if (hb < 12 || hb > 17) return "warning";
  return "normal";
}

function getWbcStatus(wbc: number): StatusLevel {
  if (wbc < 3 || wbc > 15) return "critical";
  if (wbc < 4.5 || wbc > 11) return "warning";
  return "normal";
}

function getPlateletStatus(plt: number): StatusLevel {
  if (plt < 100 || plt > 450) return "critical";
  if (plt < 150 || plt > 400) return "warning";
  return "normal";
}

function statusLabel(status: StatusLevel): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function vitalSignsSvg(data: MedicalData): string {
  const items = [
    { label: "BP", value: parseBp(data.vitalSigns.bloodPressure), max: 180, status: getBpStatus(data.vitalSigns.bloodPressure) },
    { label: "HR", value: data.vitalSigns.heartRate, max: 140, status: getHeartRateStatus(data.vitalSigns.heartRate) },
    { label: "Temp", value: data.vitalSigns.temperature, max: 42, status: getTempStatus(data.vitalSigns.temperature) },
    { label: "RR", value: data.vitalSigns.respiratoryRate, max: 30, status: getRespStatus(data.vitalSigns.respiratoryRate) },
    { label: "SpO2", value: data.vitalSigns.oxygenSaturation, max: 100, status: getOxygenStatus(data.vitalSigns.oxygenSaturation) },
  ];

  const barWidth = 45;
  const gap = 25;
  const chartHeight = 180;
  const padding = 40;
  const totalWidth = padding * 2 + items.length * (barWidth + gap) - gap;

  const bars = items
    .map((item, i) => {
      const barHeight = Math.max(4, (item.value / item.max) * (chartHeight - 40));
      const x = padding + i * (barWidth + gap);
      const y = chartHeight - barHeight + 10;
      const color = STATUS_COLORS[item.status];
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="4" opacity="0.85"/>
        <text x="${x + barWidth / 2}" y="${chartHeight + 25}" text-anchor="middle" font-size="11" fill="#6b7280">${item.label}</text>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#374151" font-weight="600">${item.value}</text>`;
    })
    .join("");

  return `<svg width="${totalWidth}" height="${chartHeight + 40}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${padding}" y1="${chartHeight + 10}" x2="${totalWidth - padding}" y2="${chartHeight + 10}" stroke="#e5e7eb" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function labResultsSvg(data: MedicalData): string {
  const items = [
    { label: "Glucose", value: data.labResults.glucose, max: 200, status: getGlucoseStatus(data.labResults.glucose) },
    { label: "Cholesterol", value: data.labResults.cholesterol, max: 300, status: getCholesterolStatus(data.labResults.cholesterol) },
    { label: "Hemoglobin", value: data.labResults.hemoglobin, max: 20, status: getHemoglobinStatus(data.labResults.hemoglobin) },
    { label: "WBC", value: data.labResults.whiteBloodCells, max: 20, status: getWbcStatus(data.labResults.whiteBloodCells) },
    { label: "Platelets", value: data.labResults.platelets, max: 500, status: getPlateletStatus(data.labResults.platelets) },
  ];

  const barWidth = 45;
  const gap = 25;
  const chartHeight = 180;
  const padding = 40;
  const totalWidth = padding * 2 + items.length * (barWidth + gap) - gap;

  const bars = items
    .map((item, i) => {
      const barHeight = Math.max(4, (item.value / item.max) * (chartHeight - 40));
      const x = padding + i * (barWidth + gap);
      const y = chartHeight - barHeight + 10;
      const color = STATUS_COLORS[item.status];
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="4" opacity="0.85"/>
        <text x="${x + barWidth / 2}" y="${chartHeight + 25}" text-anchor="middle" font-size="10" fill="#6b7280">${item.label}</text>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="10" fill="#374151" font-weight="600">${item.value}</text>`;
    })
    .join("");

  return `<svg width="${totalWidth}" height="${chartHeight + 40}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${padding}" y1="${chartHeight + 10}" x2="${totalWidth - padding}" y2="${chartHeight + 10}" stroke="#e5e7eb" stroke-width="1"/>
    ${bars}
  </svg>`;
}

function vitalRow(label: string, value: string | number, unit: string, normalRange: string, status: StatusLevel): string {
  return `<tr>
    <td>${label}</td>
    <td>${value} ${unit}</td>
    <td>${normalRange}</td>
    <td style="color: ${STATUS_COLORS[status]}; font-weight: 600;">${statusLabel(status)}</td>
  </tr>`;
}

function labRow(label: string, value: number, unit: string, normalRange: string, status: StatusLevel): string {
  return `<tr>
    <td>${label}</td>
    <td>${value} ${unit}</td>
    <td>${normalRange}</td>
    <td style="color: ${STATUS_COLORS[status]}; font-weight: 600;">${statusLabel(status)}</td>
  </tr>`;
}

export function generateHtmlReport(data: MedicalData, analysis: AnalysisResult): string {
  const colors = RISK_COLORS[analysis.riskLevel];
  const generatedAt = new Date().toLocaleString();

  const vitalRows = [
    vitalRow("Blood Pressure", data.vitalSigns.bloodPressure, "mmHg", "<120/80 mmHg", getBpStatus(data.vitalSigns.bloodPressure)),
    vitalRow("Heart Rate", data.vitalSigns.heartRate, "bpm", "60-100 bpm", getHeartRateStatus(data.vitalSigns.heartRate)),
    vitalRow("Temperature", data.vitalSigns.temperature, "°C", "36.5-37.5°C", getTempStatus(data.vitalSigns.temperature)),
    vitalRow("Respiratory Rate", data.vitalSigns.respiratoryRate, "breaths/min", "12-20 breaths/min", getRespStatus(data.vitalSigns.respiratoryRate)),
    vitalRow("Oxygen Saturation", data.vitalSigns.oxygenSaturation, "%", "95-100%", getOxygenStatus(data.vitalSigns.oxygenSaturation)),
  ].join("");

  const labRows = [
    labRow("Glucose", data.labResults.glucose, "mg/dL", "70-100 mg/dL (fasting)", getGlucoseStatus(data.labResults.glucose)),
    labRow("Cholesterol", data.labResults.cholesterol, "mg/dL", "<200 mg/dL", getCholesterolStatus(data.labResults.cholesterol)),
    labRow("Hemoglobin", data.labResults.hemoglobin, "g/dL", "12-17 g/dL", getHemoglobinStatus(data.labResults.hemoglobin)),
    labRow("White Blood Cells", data.labResults.whiteBloodCells, "x10³/μL", "4.5-11 x10³/μL", getWbcStatus(data.labResults.whiteBloodCells)),
    labRow("Platelets", data.labResults.platelets, "x10³/μL", "150-400 x10³/μL", getPlateletStatus(data.labResults.platelets)),
  ].join("");

  const findingsSection =
    analysis.abnormalFindings.length > 0
      ? `<div class="section">
    <h2>Abnormal Findings</h2>
    <div class="findings">
      <ul>
        ${analysis.abnormalFindings.map((f) => `<li>${f}</li>`).join("")}
      </ul>
    </div>
  </div>`
      : "";

  const symptomsSection =
    data.symptoms.length > 0
      ? `<div class="section"><h2>Reported Symptoms</h2><div class="findings"><ul>${data.symptoms.map((s) => `<li>${s}</li>`).join("")}</ul></div></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Medical Analysis Report - ${data.patientId}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 20px;
      background: #f9fafb;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    @media (max-width: 600px) {
      .container { padding: 20px; }
      .patient-info { grid-template-columns: 1fr !important; }
    }
    .header {
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0 0 10px 0;
      color: #1f2937;
      font-size: 28px;
    }
    .header p {
      margin: 0;
      color: #6b7280;
      font-size: 14px;
    }
    .patient-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
      padding: 20px;
      background: #f3f4f6;
      border-radius: 6px;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
    }
    .info-label {
      font-weight: 600;
      color: #6b7280;
    }
    .info-value {
      color: #1f2937;
      font-weight: 500;
    }
    .risk-badge {
      display: inline-block;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 16px;
      color: white;
      background: ${colors.badge};
      margin: 20px 0;
    }
    .section {
      margin: 30px 0;
    }
    .section h2 {
      color: #1f2937;
      font-size: 20px;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .chart-container {
      text-align: center;
      margin: 15px 0;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    th {
      background: #f3f4f6;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #374151;
      border-bottom: 2px solid #e5e7eb;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    tr:hover {
      background: #f9fafb;
    }
    .findings {
      background: ${colors.bg};
      border-left: 4px solid ${colors.border};
      padding: 15px;
      margin: 15px 0;
      border-radius: 4px;
    }
    .findings ul {
      margin: 10px 0;
      padding-left: 20px;
    }
    .findings li {
      margin: 8px 0;
      color: #374151;
    }
    .recommendations {
      background: #ecfdf5;
      border-left: 4px solid #10b981;
      padding: 15px;
      margin: 15px 0;
      border-radius: 4px;
    }
    .recommendations ul {
      margin: 10px 0;
      padding-left: 20px;
    }
    .recommendations li {
      margin: 8px 0;
      color: #374151;
    }
    .summary {
      background: #eff6ff;
      border-left: 4px solid #3b82f6;
      padding: 15px;
      margin: 15px 0;
      border-radius: 4px;
      font-style: italic;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      text-align: center;
      color: #6b7280;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Medical Analysis Report</h1>
      <p>Generated on ${generatedAt}</p>
    </div>

    <div class="section">
      <h2>Patient Information</h2>
      <div class="patient-info">
        <div class="info-item">
          <span class="info-label">Patient ID:</span>
          <span class="info-value">${data.patientId}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Name:</span>
          <span class="info-value">${data.patientName}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Age:</span>
          <span class="info-value">${data.age} years</span>
        </div>
        <div class="info-item">
          <span class="info-label">Gender:</span>
          <span class="info-value">${data.gender}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Risk Assessment</h2>
      <div class="risk-badge">${analysis.riskLevel.toUpperCase()} RISK</div>
      <div class="summary">${analysis.summary}</div>
    </div>

    <div class="section">
      <h2>Vital Signs</h2>
      <div class="chart-container">${vitalSignsSvg(data)}</div>
      <table>
        <thead>
          <tr>
            <th>Measurement</th>
            <th>Value</th>
            <th>Normal Range</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${vitalRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Laboratory Results</h2>
      <div class="chart-container">${labResultsSvg(data)}</div>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Value</th>
            <th>Normal Range</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${labRows}</tbody>
      </table>
    </div>

    ${symptomsSection}

    ${findingsSection}

    <div class="section">
      <h2>Clinical Recommendations</h2>
      <div class="recommendations">
        <ul>
          ${analysis.recommendations.map((r) => `<li>${r}</li>`).join("")}
        </ul>
      </div>
    </div>

    <div class="footer">
      <p>This report is generated for demonstration purposes. For medical decisions, consult with a healthcare professional.</p>
      <p>Generated by Medical Data Processing Service | ${new Date().toISOString()}</p>
    </div>
  </div>
</body>
</html>`;
}
