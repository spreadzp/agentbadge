import type { TypedDataset, ColumnSummary, DescriptiveStats } from "../types";

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function min(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.min(...values);
}

export function max(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

export function quartiles(values: number[]): { q1: number; q3: number; iqr: number } {
  if (values.length === 0) return { q1: 0, q3: 0, iqr: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  const lowerHalf = sorted.slice(0, mid);
  const upperHalf = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);

  const q1 = lowerHalf.length === 0 ? sorted[0] : median(lowerHalf);
  const q3 = upperHalf.length === 0 ? sorted[sorted.length - 1] : median(upperHalf);

  return { q1, q3, iqr: q3 - q1 };
}

export function nullCount(column: (number | null)[]): number {
  return column.filter((v) => v === null).length;
}

export function uniqueCount(column: (number | string | boolean | null)[]): number {
  const seen = new Set<string>();
  for (const v of column) {
    seen.add(String(v));
  }
  return seen.size;
}

export function summarizeColumn(
  name: string,
  values: (number | null)[]
): ColumnSummary {
  const count = values.length;
  const nc = nullCount(values);
  const nonNull = values.filter((v): v is number => v !== null);

  if (nonNull.length === 0) {
    return {
      name,
      type: "number",
      count,
      nullCount: nc,
      uniqueCount: uniqueCount(values),
      mean: null,
      median: null,
      stdDev: null,
      min: null,
      max: null,
      q1: null,
      q3: null,
      iqr: null,
    };
  }

  const q = quartiles(nonNull);

  return {
    name,
    type: "number",
    count,
    nullCount: nc,
    uniqueCount: uniqueCount(values),
    mean: mean(nonNull),
    median: median(nonNull),
    stdDev: stdDev(nonNull),
    min: min(nonNull),
    max: max(nonNull),
    q1: q.q1,
    q3: q.q3,
    iqr: q.iqr,
  };
}

export function computeDescriptiveStats(dataset: TypedDataset): DescriptiveStats {
  return dataset.columns.map((colName, i) => {
    const colType = dataset.types[i];
    const colValues = dataset.rows.map((row) => row[i]);
    const nulls = colValues.filter((v) => v === null).length;
    const uniques = uniqueCount(colValues);

    if (colType !== "number") {
      return {
        name: colName,
        type: colType,
        count: colValues.length,
        nullCount: nulls,
        uniqueCount: uniques,
        mean: null,
        median: null,
        stdDev: null,
        min: null,
        max: null,
        q1: null,
        q3: null,
        iqr: null,
      };
    }

    const numericValues = colValues.filter((v): v is number => v !== null);
    const summary = summarizeColumn(colName, colValues as (number | null)[]);
    return { ...summary, count: colValues.length, nullCount: nulls };
  });
}
