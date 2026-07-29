export interface VitalSigns {
  heartRate: number;
  bloodPressure: string;
  temperature: number;
  respiratoryRate: number;
  oxygenSaturation: number;
}

export interface LabResults {
  glucose: number;
  cholesterol: number;
  hemoglobin: number;
  whiteBloodCells: number;
  platelets: number;
}

export interface MedicalData {
  patientId: string;
  patientName: string;
  age: number;
  gender: "M" | "F";
  vitalSigns: VitalSigns;
  labResults: LabResults;
  symptoms: string[];
  medicalHistory: string[];
  timestamp: string;
}

const PATIENTS = [
  { id: "P001", name: "John Doe" },
  { id: "P002", name: "Jane Smith" },
  { id: "P003", name: "Bob Johnson" },
  { id: "P004", name: "Alice Williams" },
  { id: "P005", name: "Charlie Brown" },
];

const SYMPTOMS = ["headache", "fatigue", "fever", "cough", "nausea", "dizziness", "chest pain", "shortness of breath"];
const HISTORY = ["hypertension", "diabetes", "asthma", "arthritis", "none", "allergies", "high cholesterol"];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSome<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function generateRandomMedicalData(): MedicalData {
  const patient = pick(PATIENTS);
  return {
    patientId: patient.id,
    patientName: patient.name,
    age: randInt(18, 80),
    gender: Math.random() > 0.5 ? "M" : "F",
    vitalSigns: {
      heartRate: randInt(60, 100),
      bloodPressure: `${randInt(100, 140)}/${randInt(70, 90)}`,
      temperature: randFloat(36.5, 37.5),
      respiratoryRate: randInt(12, 20),
      oxygenSaturation: randInt(95, 100),
    },
    labResults: {
      glucose: randInt(70, 120),
      cholesterol: randInt(150, 240),
      hemoglobin: randFloat(12, 17),
      whiteBloodCells: randFloat(4.5, 11),
      platelets: randInt(150, 400),
    },
    symptoms: pickSome(SYMPTOMS, randInt(0, 3)),
    medicalHistory: pickSome(HISTORY, randInt(0, 2)),
    timestamp: new Date().toISOString(),
  };
}

const SAMPLES: MedicalData[] = [
  {
    patientId: "P001",
    patientName: "John Doe",
    age: 45,
    gender: "M",
    vitalSigns: {
      heartRate: 72,
      bloodPressure: "120/80",
      temperature: 37.2,
      respiratoryRate: 16,
      oxygenSaturation: 98,
    },
    labResults: {
      glucose: 95,
      cholesterol: 180,
      hemoglobin: 14.5,
      whiteBloodCells: 7.2,
      platelets: 250,
    },
    symptoms: ["mild headache"],
    medicalHistory: ["hypertension"],
    timestamp: "2026-07-24T11:05:00Z",
  },
  {
    patientId: "P002",
    patientName: "Jane Smith",
    age: 62,
    gender: "F",
    vitalSigns: {
      heartRate: 88,
      bloodPressure: "145/92",
      temperature: 37.8,
      respiratoryRate: 22,
      oxygenSaturation: 94,
    },
    labResults: {
      glucose: 145,
      cholesterol: 220,
      hemoglobin: 11.2,
      whiteBloodCells: 13.5,
      platelets: 180,
    },
    symptoms: ["fatigue", "dizziness", "shortness of breath"],
    medicalHistory: ["diabetes", "high cholesterol"],
    timestamp: "2026-07-24T11:10:00Z",
  },
  {
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
  },
];

export function getMedicalDataById(id: string): MedicalData | undefined {
  return SAMPLES.find((s) => s.patientId === id);
}

export function getAllSamples(): MedicalData[] {
  return SAMPLES;
}
