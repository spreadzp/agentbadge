import { describe, it, expect } from "vitest";
import {
  parseCSV,
  inferColumnType,
  validateSchema,
  coerceTypes,
  type ParsedCSV,
} from "../../src/agents/csv-parser";
import type { DatasetMetadata, TypedDataset } from "../../src/agents/types";

// ─── parseCSV ──────────────────────────────────────────────────────

describe("parseCSV", () => {
  it("parses simple CSV", () => {
    const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA";
    const result = parseCSV(csv);
    expect(result.headers).toEqual(["name", "age", "city"]);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]).toEqual({ name: "Alice", age: "30", city: "NYC" });
    expect(result.rowCount).toBe(2);
  });

  it("handles quoted fields with commas", () => {
    const csv = 'name,note\n"Smith, John","has, comma"';
    const result = parseCSV(csv);
    expect(result.rows[0].name).toBe("Smith, John");
    expect(result.rows[0].note).toBe("has, comma");
  });

  it("handles escaped quotes (double-quote inside quoted field)", () => {
    const csv = 'name,note\n"John","says ""hi"""';
    const result = parseCSV(csv);
    expect(result.rows[0].note).toBe('says "hi"');
  });

  it("handles CRLF line endings", () => {
    const csv = "a,b\r\n1,2\r\n3,4";
    const result = parseCSV(csv);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("handles LF line endings", () => {
    const csv = "a,b\n1,2\n3,4";
    const result = parseCSV(csv);
    expect(result.rows.length).toBe(2);
  });

  it("auto-detects semicolon delimiter", () => {
    const csv = "a;b\n1;2\n3;4";
    const result = parseCSV(csv);
    expect(result.headers).toEqual(["a", "b"]);
    expect(result.rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("auto-detects tab delimiter", () => {
    const csv = "a\tb\n1\t2\n3\t4";
    const result = parseCSV(csv);
    expect(result.headers).toEqual(["a", "b"]);
  });

  it("throws on empty CSV", () => {
    expect(() => parseCSV("")).toThrow("empty");
  });

  it("throws on unclosed quotes", () => {
    const csv = 'name,note\n"John","unclosed';
    expect(() => parseCSV(csv)).toThrow("unclosed");
  });

  it("handles empty values as empty strings", () => {
    const csv = "a,b,c\n1,,3";
    const result = parseCSV(csv);
    expect(result.rows[0].b).toBe("");
  });

  it("skips empty trailing lines", () => {
    const csv = "a,b\n1,2\n\n";
    const result = parseCSV(csv);
    expect(result.rows.length).toBe(1);
  });
});

// ─── inferColumnType ───────────────────────────────────────────────

describe("inferColumnType", () => {
  it("infers number for numeric values", () => {
    expect(inferColumnType(["1", "2", "3", "42"])).toBe("number");
  });

  it("infers number for decimal values", () => {
    expect(inferColumnType(["1.5", "2.3", "3.0"])).toBe("number");
  });

  it("infers boolean for 0/1 values", () => {
    expect(inferColumnType(["0", "1", "0", "1"])).toBe("boolean");
  });

  it("infers string for mixed values", () => {
    expect(inferColumnType(["hello", "world"])).toBe("string");
  });

  it("infers string for alphanumeric", () => {
    expect(inferColumnType(["M", "B", "M"])).toBe("string");
  });

  it("infers number even with some empty values", () => {
    expect(inferColumnType(["1", "", "3", ""])).toBe("number");
  });
});

// ─── validateSchema ────────────────────────────────────────────────

describe("validateSchema", () => {
  const schema: DatasetMetadata = {
    columns: ["glucose", "bmi", "age"],
    columnTypes: ["number", "number", "number"],
    rowCount: 3,
    datasetName: "Test",
  };

  it("passes when schema matches", () => {
    const parsed: ParsedCSV = {
      headers: ["glucose", "bmi", "age"],
      rows: [{ glucose: "120", bmi: "28", age: "35" }],
      rowCount: 1,
    };
    const result = validateSchema(parsed, schema);
    expect(result.passed).toBe(true);
    expect(result.failedChecks.length).toBe(0);
  });

  it("reports missing columns", () => {
    const parsed: ParsedCSV = {
      headers: ["glucose", "bmi"],
      rows: [],
      rowCount: 0,
    };
    const result = validateSchema(parsed, schema);
    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((c) => c.includes("age"))).toBe(true);
  });

  it("reports extra columns as warning (not failure)", () => {
    const parsed: ParsedCSV = {
      headers: ["glucose", "bmi", "age", "extra"],
      rows: [{ glucose: "1", bmi: "2", age: "3", extra: "x" }],
      rowCount: 1,
    };
    const result = validateSchema(parsed, schema);
    // Extra columns are warnings, not failures
    expect(result.failedChecks).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

// ─── coerceTypes ───────────────────────────────────────────────────

describe("coerceTypes", () => {
  it("converts string to number", () => {
    const parsed: ParsedCSV = {
      headers: ["glucose", "age"],
      rows: [{ glucose: "120", age: "35" }],
      rowCount: 1,
    };
    const schema: DatasetMetadata = {
      columns: ["glucose", "age"],
      columnTypes: ["number", "number"],
      rowCount: 1,
      datasetName: "Test",
    };
    const result = coerceTypes(parsed, schema);
    expect(result.rows[0][0]).toBe(120);
    expect(result.rows[0][1]).toBe(35);
    expect(result.types).toEqual(["number", "number"]);
  });

  it("converts empty string to null", () => {
    const parsed: ParsedCSV = {
      headers: ["glucose"],
      rows: [{ glucose: "" }],
      rowCount: 1,
    };
    const schema: DatasetMetadata = {
      columns: ["glucose"],
      columnTypes: ["number"],
      rowCount: 1,
      datasetName: "Test",
    };
    const result = coerceTypes(parsed, schema);
    expect(result.rows[0][0]).toBeNull();
  });

  it("converts 0/1 to boolean when schema says boolean", () => {
    const parsed: ParsedCSV = {
      headers: ["outcome"],
      rows: [{ outcome: "1" }, { outcome: "0" }],
      rowCount: 2,
    };
    const schema: DatasetMetadata = {
      columns: ["outcome"],
      columnTypes: ["boolean"],
      rowCount: 2,
      datasetName: "Test",
    };
    const result = coerceTypes(parsed, schema);
    expect(result.rows[0][0]).toBe(true);
    expect(result.rows[1][0]).toBe(false);
  });

  it("produces TypedDataset with correct columns", () => {
    const parsed: ParsedCSV = {
      headers: ["a", "b"],
      rows: [{ a: "1", b: "x" }],
      rowCount: 1,
    };
    const schema: DatasetMetadata = {
      columns: ["a", "b"],
      columnTypes: ["number", "string"],
      rowCount: 1,
      datasetName: "Test",
    };
    const result = coerceTypes(parsed, schema);
    expect(result.columns).toEqual(["a", "b"]);
    expect(result.rows[0]).toEqual([1, "x"]);
    expect(result.types).toEqual(["number", "string"]);
  });

  it("handles Pima Diabetes CSV sample (10 rows)", () => {
    const csv = "Pregnancies,Glucose,BloodPressure,SkinThickness,Insulin,BMI,DiabetesPedigreeFunction,Age,Outcome\n" +
      Array.from({ length: 10 }, (_, i) =>
        `${6 + i},${110 + i * 5},${70 + i},${20 + i},${80 + i * 3},${25 + i * 0.5},${0.3 + i * 0.05},${30 + i},${i % 2}`
      ).join("\n");
    const parsed = parseCSV(csv);
    const schema: DatasetMetadata = {
      columns: ["Pregnancies", "Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI", "DiabetesPedigreeFunction", "Age", "Outcome"],
      columnTypes: ["number", "number", "number", "number", "number", "number", "number", "number", "boolean"],
      rowCount: 10,
      datasetName: "Pima Indians Diabetes",
    };
    const result = coerceTypes(parsed, schema);
    expect(result.columns.length).toBe(9);
    expect(result.rows.length).toBe(10);
    expect(typeof result.rows[0][0]).toBe("number");
    expect(typeof result.rows[0][8]).toBe("boolean");
  });
});
