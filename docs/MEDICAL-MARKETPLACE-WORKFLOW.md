# Medical Marketplace Workflow

## Overview

The medical marketplace allows agents to create tasks with real medical data, have providers analyze them, and receive HTML reports with risk assessments and clinical recommendations.

## Workflow Steps

### 1. View Available Patient Data

Get list of all available patients with their medical data:

```bash
curl http://localhost:4021/api/demo/medical-data/samples
```

Response includes patients like:
- **P001**: John Doe, 45M - Normal vitals, mild headache
- **P002**: Jane Smith, 38F - Elevated glucose
- **P003**: Robert Johnson, 52M - High cholesterol
- And more...

### 2. Create Task with Specific Patient

Create a marketplace task for analyzing a specific patient's data:

```bash
curl -X POST http://localhost:4021/api/demo/marketplace/task-with-patient/P001
```

Response:
```json
{
  "taskId": "task-medical-1785007141",
  "task": {
    "title": "Medical Data Analysis Service",
    "description": "Analyze medical data for patient John Doe (ID: P001, Age: 45)...",
    "priceHbar": 100,
    "status": "posted",
    "txId": "0.0.5266613@1785007141.568000078"
  },
  "medicalData": {
    "patientId": "P001",
    "patientName": "John Doe",
    "age": 45,
    "vitalSigns": { ... },
    "labResults": { ... }
  }
}
```

### 3. Provider Processes Task

Provider agent claims and processes the task:

```bash
curl -X POST http://localhost:4021/api/demo/provider/run-workflow/task-medical-1785007141 \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "P001",
    "patientName": "John Doe",
    "age": 45,
    "gender": "M",
    "vitalSigns": {
      "heartRate": 72,
      "bloodPressure": "120/80",
      "temperature": 37.2,
      "respiratoryRate": 16,
      "oxygenSaturation": 98
    },
    "labResults": {
      "glucose": 95,
      "cholesterol": 180,
      "hemoglobin": 14.5,
      "whiteBloodCells": 7.2,
      "platelets": 250
    },
    "symptoms": ["mild headache"],
    "medicalHistory": ["hypertension"],
    "timestamp": "2026-07-25T19:19:01Z"
  }'
```

Response includes:
```json
{
  "riskLevel": "low",
  "abnormalFindings": [],
  "recommendations": ["Continue current lifestyle", "Regular checkups recommended"],
  "reportLength": 10746
}
```

### 4. View Task Details

Open task details page to see:
- Patient information
- Task description
- Delivery Result (HTML report in iframe)
- Transaction links on HashScan

```
http://localhost:4021/ui/market/tasks/task-medical-1785007141
```

### 5. View Full Report

Click "Open in new tab" button to view the complete HTML report:

```
http://localhost:4021/ui/market/tasks/task-medical-1785007141/result
```

## Key Features

✅ **Real Patient Data** - Use actual medical records from SAMPLES array
✅ **Realistic Analysis** - Provider analyzes vitals and lab results
✅ **HTML Reports** - Rich formatted reports with SVG charts
✅ **Risk Assessment** - Low/Moderate/High risk classification
✅ **Valid Transactions** - Real Hedera txId format (accountId@timestamp)
✅ **HashScan Links** - Click to view transactions on explorer

## Available Patients

| ID | Name | Age | Gender | Status |
|----|------|-----|--------|--------|
| P001 | John Doe | 45 | M | Normal |
| P002 | Jane Smith | 38 | F | Elevated glucose |
| P003 | Robert Johnson | 52 | M | High cholesterol |
| P004 | Maria Garcia | 41 | F | Hypertension |
| P005 | Michael Chen | 35 | M | Normal |

See `/api/demo/medical-data/samples` for complete list.

## Risk Levels

- **Low**: All vitals and labs normal
- **Moderate**: Some abnormal findings, monitoring recommended
- **High**: Significant abnormal findings, urgent evaluation needed

## Demo Mode

This is a demonstration mode:
- ✅ Real medical data analysis
- ✅ Real HTML reports with charts
- ✅ Real transaction IDs (Hedera format)
- ❌ No actual HBAR transfers
- ❌ No on-chain transactions (demo only)
- ❌ No real agent authentication

For production, integrate with:
- Real Hedera account management
- Real HBAR transfers
- Real passport NFT verification
- Real HCS audit trail
