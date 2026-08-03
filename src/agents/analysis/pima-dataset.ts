import type { TypedDataset } from "../types";

// Pima Indians Diabetes Database columns
const COLUMNS = [
  "pregnancies",
  "glucose",
  "bloodPressure",
  "skinThickness",
  "insulin",
  "bmi",
  "diabetesPedigree",
  "age",
  "outcome",
];

const TYPES: ("number")[] = COLUMNS.map(() => "number");

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 1): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function maybeNull(prob: number): number | null {
  return Math.random() < prob ? null : 0; // placeholder, replaced below
}

function generateRow(): (number | null)[] {
  const outcome = Math.random() < 0.35 ? 1 : 0;

  // Glucose: higher if diabetic
  const glucose = outcome === 1
    ? randInt(120, 199)
    : randInt(70, 140);

  // BMI: higher if diabetic
  const bmi = outcome === 1
    ? randFloat(28, 50, 1)
    : randFloat(18, 35, 1);

  // Age: slightly higher if diabetic
  const age = outcome === 1
    ? randInt(25, 65)
    : randInt(21, 55);

  // Pregnancies: correlates with age
  const pregnancies = age > 30 ? randInt(1, 12) : randInt(0, 5);

  // Blood pressure
  const bloodPressure = randInt(40, 122);

  // Skin thickness — sometimes null (0 = missing in Pima)
  const skinThickness = Math.random() < 0.3 ? 0 : randInt(10, 60);

  // Insulin — frequently null (0 = missing in Pima)
  const insulin = Math.random() < 0.49 ? 0 : randInt(15, 846);

  // Diabetes pedigree function
  const diabetesPedigree = randFloat(0.05, 2.5, 3);

  return [pregnancies, glucose, bloodPressure, skinThickness, insulin, bmi, diabetesPedigree, age, outcome];
}

export function generatePimaDataset(rowCount = 100): TypedDataset {
  const rows = Array.from({ length: rowCount }, () => generateRow());
  return {
    columns: COLUMNS,
    types: TYPES,
    rows,
  };
}

// Small fixed sample for testing
export function generatePimaSample(): TypedDataset {
  return {
    columns: COLUMNS,
    types: TYPES,
    rows: [
      [6, 148, 72, 35, 0, 33.6, 0.627, 50, 1],
      [1, 85, 66, 29, 0, 26.6, 0.351, 31, 0],
      [8, 183, 64, 0, 0, 23.3, 0.672, 32, 1],
      [1, 89, 66, 23, 94, 28.1, 0.167, 21, 0],
      [0, 137, 40, 35, 168, 43.1, 2.288, 33, 1],
      [5, 116, 74, 0, 0, 25.6, 0.201, 30, 0],
      [3, 78, 50, 32, 88, 31.0, 0.248, 26, 1],
      [10, 115, 0, 0, 0, 35.3, 0.134, 29, 0],
      [2, 197, 70, 45, 543, 30.5, 0.158, 53, 1],
      [8, 125, 96, 0, 0, 0.0, 0.232, 54, 1],
      [4, 110, 92, 0, 0, 37.6, 0.191, 30, 0],
      [10, 168, 74, 0, 0, 38.0, 0.537, 34, 1],
      [10, 139, 80, 0, 0, 27.1, 1.441, 57, 0],
      [1, 189, 60, 23, 846, 30.1, 0.398, 59, 1],
      [5, 166, 72, 19, 175, 25.8, 0.587, 51, 1],
    ],
  };
}
