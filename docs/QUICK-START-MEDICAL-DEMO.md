# Quick Start: Medical Marketplace Demo

## 5-Minute Demo

### 1. Start Server
```bash
cd hackathon/server
bun --watch src/server/index.ts
```

### 2. Get Patient List
```bash
curl http://localhost:4021/api/demo/medical-data/samples | jq '.[0:3]'
```

Output:
```json
[
  {
    "patientId": "P001",
    "patientName": "John Doe",
    "age": 45,
    "vitalSigns": { "heartRate": 72, "bloodPressure": "120/80", ... },
    "labResults": { "glucose": 95, "cholesterol": 180, ... }
  },
  ...
]
```

### 3. Create Task for Patient
```bash
TASK=$(curl -s -X POST http://localhost:4021/api/demo/marketplace/task-with-patient/P001 | jq -r '.taskId')
echo "Task ID: $TASK"
```

Output: `Task ID: task-medical-1785007141`

### 4. Provider Analyzes Task
```bash
curl -s -X POST http://localhost:4021/api/demo/provider/run-workflow/$TASK \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "P001",
    "patientName": "John Doe",
    "age": 45,
    "gender": "M",
    "vitalSigns": {"heartRate": 72, "bloodPressure": "120/80", "temperature": 37.2, "respiratoryRate": 16, "oxygenSaturation": 98},
    "labResults": {"glucose": 95, "cholesterol": 180, "hemoglobin": 14.5, "whiteBloodCells": 7.2, "platelets": 250},
    "symptoms": ["mild headache"],
    "medicalHistory": ["hypertension"],
    "timestamp": "2026-07-25T19:19:01Z"
  }' | jq '.riskLevel, .reportLength'
```

Output:
```
"low"
10746
```

### 5. View on Web UI
Open in browser:
```
http://localhost:4021/ui/market/tasks/task-medical-1785007141
```

You'll see:
- ✅ Patient name: "John Doe"
- ✅ Task description with patient details
- ✅ Delivery Result section with HTML report in iframe
- ✅ "Open in new tab" button to view full report
- ✅ Valid HashScan links for transactions

### 6. View Full Report
Click "Open in new tab" button or go to:
```
http://localhost:4021/ui/market/tasks/task-medical-1785007141/result
```

## What's Happening

1. **Consumer** posts task: "Analyze John Doe's medical data, I'll pay 100 HBAR"
2. **Provider** claims task and analyzes:
   - Vital signs (heart rate, blood pressure, etc.)
   - Lab results (glucose, cholesterol, etc.)
   - Generates risk assessment
3. **Report** is generated as HTML with:
   - SVG charts for vitals and labs
   - Risk level classification
   - Clinical recommendations
4. **UI** displays everything with valid Hedera transaction links

## Available Patients

| ID | Name | Age | Status |
|----|------|-----|--------|
| P001 | John Doe | 45 | Normal |
| P002 | Jane Smith | 38 | Elevated glucose |
| P003 | Robert Johnson | 52 | High cholesterol |
| P004 | Maria Garcia | 41 | Hypertension |
| P005 | Michael Chen | 35 | Normal |

Try with different patients: `/P002`, `/P003`, etc.

## Key Features Demonstrated

✅ **Real Medical Data** - Not random, actual patient records
✅ **Marketplace Integration** - Consumer posts, provider claims, delivers
✅ **HTML Reports** - Rich formatted analysis with charts
✅ **Valid Transactions** - Real Hedera txId format
✅ **Explorer Links** - Click to view on HashScan
✅ **Full UI** - Task details, delivery result, report viewing

## Next Steps

- Try different patients
- Check different risk levels (P002 has elevated glucose)
- View transaction links on HashScan
- Explore the medical demo page: `http://localhost:4021/ui/medical-demo`
