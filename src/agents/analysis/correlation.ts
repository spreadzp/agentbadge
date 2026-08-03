import type { TypedDataset, CorrelationMatrix, CorrelationResult } from "../types";

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;

  return num / denom;
}

function strengthOf(r: number): "weak" | "moderate" | "strong" {
  const abs = Math.abs(r);
  if (abs >= 0.7) return "strong";
  if (abs >= 0.4) return "moderate";
  return "weak";
}

function directionOf(r: number): "positive" | "negative" {
  return r >= 0 ? "positive" : "negative";
}

export function correlationMatrix(dataset: TypedDataset): CorrelationMatrix {
  const numericCols: { name: string; values: number[] }[] = [];

  for (let i = 0; i < dataset.columns.length; i++) {
    if (dataset.types[i] !== "number") continue;
    const values = dataset.rows.map((row) => row[i]).filter((v): v is number => v !== null);
    numericCols.push({ name: dataset.columns[i], values });
  }

  const n = numericCols.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairs: CorrelationResult[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else if (j > i) {
        const minLen = Math.min(numericCols[i].values.length, numericCols[j].values.length);
        const x = numericCols[i].values.slice(0, minLen);
        const y = numericCols[j].values.slice(0, minLen);
        const r = pearsonCorrelation(x, y);
        matrix[i][j] = r;
        matrix[j][i] = r;

        if (i !== j) {
          pairs.push({
            columnX: numericCols[i].name,
            columnY: numericCols[j].name,
            coefficient: r,
            pValue: 0,
            significant: Math.abs(r) >= 0.3,
            strength: strengthOf(r),
            direction: directionOf(r),
          });
        }
      }
    }
  }

  return {
    columns: numericCols.map((c) => c.name),
    matrix,
    pairs,
  };
}

export function significantCorrelations(
  matrix: CorrelationMatrix,
  threshold: number
): CorrelationResult[] {
  return matrix.pairs
    .filter((p) => Math.abs(p.coefficient) >= threshold)
    .map((p) => ({
      ...p,
      significant: true,
      pValue: p.pValue || 0,
    }));
}
