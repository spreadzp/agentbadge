import { describe, it, expect } from "vitest";
import {
  pearsonCorrelation,
  correlationMatrix,
  significantCorrelations,
} from "../../../src/agents/analysis/correlation";
import type { TypedDataset } from "../../../src/agents/types";

describe("SLICE-26-5: Correlation Analysis", () => {
  describe("pearsonCorrelation", () => {
    it("perfect positive correlation → 1", () => {
      expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);
    });

    it("perfect negative correlation → -1", () => {
      expect(pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
    });

    it("no correlation → 0", () => {
      expect(pearsonCorrelation([1, 2, 3, 4, 5], [5, 1, 4, 2, 3])).toBeCloseTo(0, 0);
    });

    it("returns 0 for arrays < 2 elements", () => {
      expect(pearsonCorrelation([1], [2])).toBe(0);
    });

    it("returns 0 for constant array", () => {
      expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBe(0);
    });
  });

  describe("correlationMatrix", () => {
    const ds: TypedDataset = {
      columns: ["a", "b", "c"],
      types: ["number", "number", "number"],
      rows: [
        [1, 2, 5],
        [2, 4, 1],
        [3, 6, 4],
        [4, 8, 2],
        [5, 10, 3],
      ],
    };

    it("produces n×n matrix", () => {
      const m = correlationMatrix(ds);
      expect(m.columns).toEqual(["a", "b", "c"]);
      expect(m.matrix).toHaveLength(3);
      expect(m.matrix[0]).toHaveLength(3);
    });

    it("diagonal is 1.0", () => {
      const m = correlationMatrix(ds);
      expect(m.matrix[0][0]).toBeCloseTo(1, 5);
      expect(m.matrix[1][1]).toBeCloseTo(1, 5);
      expect(m.matrix[2][2]).toBeCloseTo(1, 5);
    });

    it("a and b perfectly correlated → 1.0", () => {
      const m = correlationMatrix(ds);
      expect(m.matrix[0][1]).toBeCloseTo(1, 5);
    });

    it("matrix is symmetric", () => {
      const m = correlationMatrix(ds);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(m.matrix[i][j]).toBeCloseTo(m.matrix[j][i], 5);
        }
      }
    });

    it("pairs array is populated", () => {
      const m = correlationMatrix(ds);
      expect(m.pairs.length).toBeGreaterThan(0);
    });
  });

  describe("significantCorrelations", () => {
    const ds: TypedDataset = {
      columns: ["x", "y", "z"],
      types: ["number", "number", "number"],
      rows: [
        [1, 2, 5],
        [2, 4, 1],
        [3, 6, 4],
        [4, 8, 2],
        [5, 10, 3],
      ],
    };

    it("filters pairs by threshold", () => {
      const m = correlationMatrix(ds);
      const sig = significantCorrelations(m, 0.9);
      expect(sig.length).toBeGreaterThan(0);
      for (const p of sig) {
        expect(Math.abs(p.coefficient)).toBeGreaterThanOrEqual(0.9);
      }
    });

    it("marks significant as true", () => {
      const m = correlationMatrix(ds);
      const sig = significantCorrelations(m, 0.5);
      for (const p of sig) {
        expect(p.significant).toBe(true);
      }
    });

    it("assigns strength categories", () => {
      const m = correlationMatrix(ds);
      const sig = significantCorrelations(m, 0.0);
      const strengths = sig.map((p) => p.strength);
      expect(strengths).toContain("strong");
    });
  });
});
