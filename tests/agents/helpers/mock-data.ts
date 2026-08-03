/**
 * SLICE-26-13: Mock data helpers for integration tests
 */

import { generatePimaSample } from "../../../src/agents/analysis/pima-dataset";
import type { TypedDataset } from "../../../src/agents/types";

export function mockPimaDataset(rows = 10): TypedDataset {
  return generatePimaSample();
}

export function mockHeartDataset(rows = 10): TypedDataset {
  const columns = ["age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak", "slope", "ca", "thal", "target"];
  const types: ("number" | "string" | "boolean")[] = columns.map(() => "number");

  const data: number[][] = [];
  for (let i = 0; i < rows; i++) {
    data.push([
      40 + i * 3, // age
      i % 2, // sex
      i % 4, // cp
      120 + i * 2, // trestbps
      180 + i * 5, // chol
      i % 2, // fbs
      i % 3, // restecg
      140 + i * 3, // thalach
      i % 2, // exang
      0.5 + i * 0.1, // oldpeak
      i % 3, // slope
      i % 4, // ca
      i % 3, // thal
      i % 2, // target
    ]);
  }

  return {
    columns,
    rows: data.map((r) => r.map((v) => v as number | string | boolean | null)),
    types,
  };
}

export function mockBreastCancerDataset(rows = 10): TypedDataset {
  const columns = ["radius_mean", "texture_mean", "perimeter_mean", "area_mean", "smoothness_mean", "diagnosis"];
  const types: ("number" | "string" | "boolean")[] = ["number", "number", "number", "number", "number", "string"];

  const data: (number | string)[][] = [];
  for (let i = 0; i < rows; i++) {
    data.push([
      10 + i * 0.5, // radius_mean
      15 + i * 0.3, // texture_mean
      60 + i * 2, // perimeter_mean
      250 + i * 10, // area_mean
      0.08 + i * 0.005, // smoothness_mean
      i % 2 === 0 ? "M" : "B", // diagnosis
    ]);
  }

  return { columns, rows: data, types };
}

export function mockEmptyDataset(): TypedDataset {
  return { columns: ["col1", "col2"], rows: [], types: ["number", "number"] };
}

export function mockSingleRowDataset(): TypedDataset {
  return {
    columns: ["glucose", "bmi", "age"],
    rows: [[120, 28.5, 35]],
    types: ["number", "number", "number"],
  };
}

export function mockAllNullDataset(): TypedDataset {
  return {
    columns: ["glucose", "bmi", "age"],
    rows: [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ],
    types: ["number", "number", "number"],
  };
}

export function mockNonNumericInNumericColumn(): TypedDataset {
  return {
    columns: ["glucose", "bmi", "age"],
    rows: [
      [120, 28.5, 35],
      ["abc" as unknown as number, 30.1, 40],
      [130, 29.0, 45],
    ],
    types: ["number", "number", "number"],
  };
}
