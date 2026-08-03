/**
 * SLICE-26-3: CSV Parser & Schema Validator
 * RFC 4180 compliant CSV parser with auto-detect delimiter,
 * column type inference, schema validation, and type coercion.
 */

import type { DatasetMetadata, TypedDataset, ValidationResult } from "./types";

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

type ColumnType = "number" | "string" | "boolean";

/**
 * Auto-detect the delimiter from the first non-empty line.
 */
function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let maxCount = 0;

  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > maxCount) {
      maxCount = count;
      best = d;
    }
  }

  return best;
}

/**
 * Parse a single CSV line, handling quoted fields and escaped quotes.
 */
function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (double quote)
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      current += char;
      i++;
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (char === delimiter) {
        fields.push(current);
        current = "";
        i++;
        continue;
      }
      current += char;
      i++;
    }
  }

  fields.push(current);
  return fields;
}

/**
 * RFC 4180 compliant CSV parser.
 * Auto-detects delimiter (comma, semicolon, tab, pipe).
 * Handles quoted fields, escaped quotes, CRLF and LF line endings.
 */
export function parseCSV(raw: string): ParsedCSV {
  if (!raw || raw.trim().length === 0) {
    throw new Error("Cannot parse empty CSV: input is empty");
  }

  // Normalize line endings — split on \r\n or \n
  const lines = raw.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error("Cannot parse empty CSV: no lines found");
  }

  // Detect delimiter from first line
  const delimiter = detectDelimiter(lines[0]);

  // Parse headers
  const headers = parseLine(lines[0], delimiter);

  // Check for unclosed quotes in all lines
  for (let i = 0; i < lines.length; i++) {
    let quoteCount = 0;
    for (const ch of lines[i]) {
      if (ch === '"') quoteCount++;
    }
    if (quoteCount % 2 !== 0) {
      throw new Error(`Malformed CSV: unclosed quote at line ${i + 1}`);
    }
  }

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows, rowCount: rows.length };
}

/**
 * Infer column type from an array of string values.
 * Returns "number", "boolean", or "string".
 */
export function inferColumnType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== "" && v !== null && v !== undefined);

  if (nonEmpty.length === 0) return "string";

  // Check boolean (0/1)
  const allBoolean = nonEmpty.every((v) => v === "0" || v === "1");
  if (allBoolean) return "boolean";

  // Check number
  const allNumber = nonEmpty.every((v) => {
    const n = Number(v);
    return !isNaN(n) && isFinite(n);
  });
  if (allNumber) return "number";

  return "string";
}

/**
 * Validate parsed CSV against expected dataset schema.
 * Reports missing columns and type mismatches.
 * Extra columns are warnings, not failures.
 */
export function validateSchema(parsed: ParsedCSV, expected: DatasetMetadata): ValidationResult {
  const failedChecks: string[] = [];
  const checks: { description: string; passed: boolean; message: string }[] = [];

  // Check for missing columns
  for (let i = 0; i < expected.columns.length; i++) {
    const col = expected.columns[i];
    const found = parsed.headers.includes(col);
    checks.push({
      description: `column:${col}`,
      passed: found,
      message: found ? "present" : `missing column: ${col}`,
    });
    if (!found) {
      failedChecks.push(`missing column: ${col}`);
    }
  }

  // Check type inference for columns that exist
  for (let i = 0; i < expected.columns.length; i++) {
    const col = expected.columns[i];
    if (!parsed.headers.includes(col)) continue;

    const values = parsed.rows.map((r) => r[col]);
    const inferred = inferColumnType(values);
    const expectedType = expected.columnTypes[i];

    // boolean can be inferred from 0/1 values, which is also valid for number type
    const typeMatch = inferred === expectedType ||
      (expectedType === "number" && inferred === "boolean") ||
      (expectedType === "boolean" && inferred === "number");

    checks.push({
      description: `type:${col}`,
      passed: typeMatch,
      message: typeMatch ? `type ok (${inferred})` : `type mismatch: expected ${expectedType}, got ${inferred}`,
    });

    if (!typeMatch) {
      failedChecks.push(`type mismatch for ${col}: expected ${expectedType}, got ${inferred}`);
    }
  }

  // Extra columns — warning only
  for (const h of parsed.headers) {
    if (!expected.columns.includes(h)) {
      checks.push({
        description: `extra:${h}`,
        passed: true, // warnings, not failures
        message: `extra column: ${h} (ignored)`,
      });
    }
  }

  return {
    passed: failedChecks.length === 0,
    checks,
    failedChecks,
  };
}

/**
 * Coerce string values from parsed CSV into typed values.
 * Produces a TypedDataset ready for the analysis engine.
 */
export function coerceTypes(parsed: ParsedCSV, schema: DatasetMetadata): TypedDataset {
  const types = schema.columnTypes;
  const columns = schema.columns;

  const rows = parsed.rows.map((row) => {
    return columns.map((col, idx) => {
      const raw = row[col];
      if (raw === undefined || raw === "" || raw === null) {
        return null;
      }

      const type = types[idx];
      switch (type) {
        case "number": {
          const n = Number(raw);
          return isNaN(n) ? null : n;
        }
        case "boolean": {
          if (raw === "1" || raw.toLowerCase() === "true") return true;
          if (raw === "0" || raw.toLowerCase() === "false") return false;
          return null;
        }
        case "string":
          return raw;
        default:
          return raw;
      }
    });
  });

  return { columns, rows, types };
}
