#!/usr/bin/env bun

/**
 * Process medical data through analysis pipeline
 * 
 * Usage:
 *   bun scripts/process-medical-data.ts
 * 
 * This script:
 * 1. Loads Kaggle dataset
 * 2. Processes medical records through analysis
 * 3. Generates HTML reports
 * 4. Demonstrates full workflow
 */

import { loadDataset, getRandomMedicalData, getAllMedicalData, type MedicalData } from './load-kaggle-dataset';

interface AnalysisResult {
  riskLevel: 'low' | 'moderate' | 'high';
  abnormalFindings: string[];
  recommendations: string[];
  scores: {
    glucoseScore: number;
    bmiScore: number;
    bloodPressureScore: number;
    diabetesPedigreeScore: number;
  };
}

/**
 * Analyze medical data and generate risk assessment
 */
function analyzeMedicalData(data: MedicalData): AnalysisResult {
  const findings: string[] = [];
  const recommendations: string[] = [];
  const scores = {
    glucoseScore: 0,
    bmiScore: 0,
    bloodPressureScore: 0,
    diabetesPedigreeScore: 0
  };

  // Glucose analysis (normal: 70-100 mg/dL fasting)
  if (data.labResults.glucose > 126) {
    findings.push('High glucose level (diabetic range)');
    scores.glucoseScore = 3;
    recommendations.push('Consult endocrinologist for diabetes screening');
  } else if (data.labResults.glucose > 100) {
    findings.push('Elevated glucose level (prediabetic range)');
    scores.glucoseScore = 2;
    recommendations.push('Reduce sugar intake and increase physical activity');
  } else if (data.labResults.glucose < 70) {
    findings.push('Low glucose level (hypoglycemic)');
    scores.glucoseScore = 1;
    recommendations.push('Monitor blood glucose regularly');
  }

  // BMI analysis (normal: 18.5-24.9)
  if (data.labResults.bmi > 30) {
    findings.push('Obesity (BMI > 30)');
    scores.bmiScore = 2;
    recommendations.push('Weight loss program recommended');
  } else if (data.labResults.bmi > 25) {
    findings.push('Overweight (BMI 25-30)');
    scores.bmiScore = 1;
    recommendations.push('Increase physical activity');
  }

  // Blood pressure analysis (normal: <120/80)
  if (data.vitalSigns.bloodPressure > 140) {
    findings.push('High blood pressure (Stage 2 hypertension)');
    scores.bloodPressureScore = 2;
    recommendations.push('Consult cardiologist for hypertension management');
  } else if (data.vitalSigns.bloodPressure > 120) {
    findings.push('Elevated blood pressure (Stage 1 hypertension)');
    scores.bloodPressureScore = 1;
    recommendations.push('Monitor blood pressure regularly');
  }

  // Diabetes pedigree analysis
  if (data.medicalHistory.diabetesPedigree > 1.0) {
    findings.push('Strong family history of diabetes');
    scores.diabetesPedigreeScore = 2;
    recommendations.push('Genetic predisposition to diabetes - regular screening recommended');
  } else if (data.medicalHistory.diabetesPedigree > 0.5) {
    findings.push('Moderate family history of diabetes');
    scores.diabetesPedigreeScore = 1;
    recommendations.push('Monitor for diabetes risk factors');
  }

  // Calculate overall risk level
  const totalScore = scores.glucoseScore + scores.bmiScore + scores.bloodPressureScore + scores.diabetesPedigreeScore;
  let riskLevel: 'low' | 'moderate' | 'high' = 'low';
  if (totalScore >= 6) {
    riskLevel = 'high';
  } else if (totalScore >= 3) {
    riskLevel = 'moderate';
  }

  // Add general recommendations
  if (recommendations.length === 0) {
    recommendations.push('Maintain healthy lifestyle with regular exercise');
    recommendations.push('Continue regular health check-ups');
  }

  return {
    riskLevel,
    abnormalFindings: findings,
    recommendations,
    scores
  };
}

/**
 * Generate HTML report from medical data and analysis
 */
function generateHtmlReport(data: MedicalData, analysis: AnalysisResult): string {
  const riskColor = {
    low: '#10b981',
    moderate: '#f59e0b',
    high: '#ef4444'
  }[analysis.riskLevel];

  const riskBgColor = {
    low: '#ecfdf5',
    moderate: '#fffbeb',
    high: '#fef2f2'
  }[analysis.riskLevel];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Medical Analysis Report - ${data.patientId}</title>
  <style>
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
      font-weight: 600;
      font-size: 16px;
      color: white;
      background: ${riskColor};
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
    .status-normal {
      color: #10b981;
      font-weight: 600;
    }
    .status-warning {
      color: #f59e0b;
      font-weight: 600;
    }
    .status-critical {
      color: #ef4444;
      font-weight: 600;
    }
    .findings {
      background: ${riskBgColor};
      border-left: 4px solid ${riskColor};
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
      <p>Generated on ${new Date().toLocaleString()}</p>
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
    </div>

    <div class="section">
      <h2>Vital Signs</h2>
      <table>
        <thead>
          <tr>
            <th>Measurement</th>
            <th>Value</th>
            <th>Normal Range</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Blood Pressure</td>
            <td>${data.vitalSigns.bloodPressure} mmHg</td>
            <td>&lt;120/80 mmHg</td>
            <td class="${data.vitalSigns.bloodPressure > 140 ? 'status-critical' : data.vitalSigns.bloodPressure > 120 ? 'status-warning' : 'status-normal'}">
              ${data.vitalSigns.bloodPressure > 140 ? 'High' : data.vitalSigns.bloodPressure > 120 ? 'Elevated' : 'Normal'}
            </td>
          </tr>
          <tr>
            <td>Heart Rate</td>
            <td>${data.vitalSigns.heartRate} bpm</td>
            <td>60-100 bpm</td>
            <td class="status-normal">Normal</td>
          </tr>
          <tr>
            <td>Temperature</td>
            <td>${data.vitalSigns.temperature}°C</td>
            <td>36.5-37.5°C</td>
            <td class="status-normal">Normal</td>
          </tr>
          <tr>
            <td>Respiratory Rate</td>
            <td>${data.vitalSigns.respiratoryRate} breaths/min</td>
            <td>12-20 breaths/min</td>
            <td class="status-normal">Normal</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Laboratory Results</h2>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Value</th>
            <th>Normal Range</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Glucose</td>
            <td>${data.labResults.glucose} mg/dL</td>
            <td>70-100 mg/dL (fasting)</td>
            <td class="${data.labResults.glucose > 126 ? 'status-critical' : data.labResults.glucose > 100 ? 'status-warning' : 'status-normal'}">
              ${data.labResults.glucose > 126 ? 'High' : data.labResults.glucose > 100 ? 'Elevated' : 'Normal'}
            </td>
          </tr>
          <tr>
            <td>BMI</td>
            <td>${data.labResults.bmi} kg/m²</td>
            <td>18.5-24.9 kg/m²</td>
            <td class="${data.labResults.bmi > 30 ? 'status-critical' : data.labResults.bmi > 25 ? 'status-warning' : 'status-normal'}">
              ${data.labResults.bmi > 30 ? 'Obese' : data.labResults.bmi > 25 ? 'Overweight' : 'Normal'}
            </td>
          </tr>
          <tr>
            <td>Insulin</td>
            <td>${data.labResults.insulin} mu U/ml</td>
            <td>11-240 mu U/ml</td>
            <td class="status-normal">Normal</td>
          </tr>
          <tr>
            <td>Hemoglobin</td>
            <td>${data.labResults.hemoglobin} g/dL</td>
            <td>12-16 g/dL</td>
            <td class="status-normal">Normal</td>
          </tr>
          <tr>
            <td>Cholesterol</td>
            <td>${data.labResults.cholesterol} mg/dL</td>
            <td>&lt;200 mg/dL</td>
            <td class="${data.labResults.cholesterol > 240 ? 'status-critical' : data.labResults.cholesterol > 200 ? 'status-warning' : 'status-normal'}">
              ${data.labResults.cholesterol > 240 ? 'High' : data.labResults.cholesterol > 200 ? 'Borderline' : 'Normal'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    ${analysis.abnormalFindings.length > 0 ? `
    <div class="section">
      <h2>Abnormal Findings</h2>
      <div class="findings">
        <ul>
          ${analysis.abnormalFindings.map((f) => `<li>${f}</li>`).join('')}
        </ul>
      </div>
    </div>
    ` : ''}

    <div class="section">
      <h2>Clinical Recommendations</h2>
      <div class="recommendations">
        <ul>
          ${analysis.recommendations.map((r) => `<li>${r}</li>`).join('')}
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

/**
 * Demo: Process multiple records and generate reports
 */
async function demoProcessRecords(count: number = 3): Promise<void> {
  console.log(`\n🏥 Processing ${count} medical records through analysis pipeline:\n`);

  for (let i = 0; i < count; i++) {
    const medicalData = getRandomMedicalData();
    const analysis = analyzeMedicalData(medicalData);
    const htmlReport = generateHtmlReport(medicalData, analysis);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Record ${i + 1}: ${medicalData.patientId}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Patient: ${medicalData.patientName}, Age: ${medicalData.age}`);
    console.log(`Glucose: ${medicalData.labResults.glucose} mg/dL`);
    console.log(`BMI: ${medicalData.labResults.bmi} kg/m²`);
    console.log(`Blood Pressure: ${medicalData.vitalSigns.bloodPressure} mmHg`);
    console.log(`\nAnalysis:`);
    console.log(`  Risk Level: ${analysis.riskLevel.toUpperCase()}`);
    console.log(`  Abnormal Findings: ${analysis.abnormalFindings.length}`);
    console.log(`  Recommendations: ${analysis.recommendations.length}`);
    console.log(`\nHTML Report Size: ${htmlReport.length} bytes`);

    // Save report to file
    const reportPath = `./reports/report-${medicalData.patientId}.html`;
    console.log(`  Saved to: ${reportPath}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Processing complete!');
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('🏥 Medical Data Processing Pipeline\n');

  try {
    // Load dataset
    await loadDataset();

    // Process sample records
    await demoProcessRecords(3);

    console.log('\n✅ All records processed successfully!');
  } catch (error) {
    console.error('❌ Error processing records:', error);
    process.exit(1);
  }
}

// Export functions for use in other modules
export { analyzeMedicalData, generateHtmlReport };

// Run if executed directly
if (import.meta.main) {
  main();
}
