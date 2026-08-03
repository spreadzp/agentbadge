import { describe, it, expect } from "vitest";
import {
  mean,
  median,
  stdDev,
  min,
  max,
  quartiles,
  nullCount,
  uniqueCount,
  summarizeColumn,
  computeDescriptiveStats,
} from "../../../src/agents/analysis/descriptive";
import type { TypedDataset } from "../../../src/agents/types";

describe("SLICE-26-4: Descriptive Statistics", () => {
  describe("mean", () => {
    it("computes mean of [1,2,3,4,5]", () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
    });
    it("returns 0 for empty array", () => {
      expect(mean([])).toBe(0);
    });
    it("handles negative numbers", () => {
      expect(mean([-2, 0, 2])).toBe(0);
    });
  });

  describe("median", () => {
    it("odd count: [1,2,3,4,5] → 3", () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
    });
    it("even count: [1,2,3,4] → 2.5", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });
    it("single value → value", () => {
      expect(median([42])).toBe(42);
    });
  });

  describe("stdDev", () => {
    it("sample stdDev of [2,4,4,4,5,5,7,9] ≈ 2.138", () => {
      expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    });
    it("returns 0 for constant array", () => {
      expect(stdDev([5, 5, 5, 5])).toBe(0);
    });
    it("returns 0 for single value", () => {
      expect(stdDev([7])).toBe(0);
    });
    it("returns 0 for empty array", () => {
      expect(stdDev([])).toBe(0);
    });
  });

  describe("min / max", () => {
    it("min of [3,1,4,1,5,9,2,6]", () => {
      expect(min([3, 1, 4, 1, 5, 9, 2, 6])).toBe(1);
    });
    it("max of [3,1,4,1,5,9,2,6]", () => {
      expect(max([3, 1, 4, 1, 5, 9, 2, 6])).toBe(9);
    });
  });

  describe("quartiles", () => {
    it("Q1, Q3, IQR for [1..8]", () => {
      const q = quartiles([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(q.q1).toBe(2.5);
      expect(q.q3).toBe(6.5);
      expect(q.iqr).toBe(4);
    });
    it("single value → q1=q3=value, iqr=0", () => {
      const q = quartiles([5]);
      expect(q.q1).toBe(5);
      expect(q.q3).toBe(5);
      expect(q.iqr).toBe(0);
    });
  });

  describe("nullCount", () => {
    it("counts nulls in [1, null, 3, null, 5]", () => {
      expect(nullCount([1, null, 3, null, 5])).toBe(2);
    });
    it("returns 0 for no nulls", () => {
      expect(nullCount([1, 2, 3])).toBe(0);
    });
    it("returns 3 for all nulls", () => {
      expect(nullCount([null, null, null])).toBe(3);
    });
  });

  describe("uniqueCount", () => {
    it("counts unique values", () => {
      expect(uniqueCount([1, 2, 2, 3, 3, 3])).toBe(3);
    });
    it("counts nulls as a value", () => {
      expect(uniqueCount([1, null, 1, null])).toBe(2);
    });
  });

  describe("summarizeColumn", () => {
    it("summarizes numeric column with nulls", () => {
      const s = summarizeColumn("glucose", [100, null, 120, 140, null]);
      expect(s.name).toBe("glucose");
      expect(s.type).toBe("number");
      expect(s.count).toBe(5);
      expect(s.nullCount).toBe(2);
      expect(s.mean).toBe(120);
      expect(s.median).toBe(120);
      expect(s.min).toBe(100);
      expect(s.max).toBe(140);
      expect(s.stdDev).toBeCloseTo(20, 0);
    });

    it("all-null column → all stats null", () => {
      const s = summarizeColumn("empty", [null, null, null]);
      expect(s.nullCount).toBe(3);
      expect(s.mean).toBeNull();
      expect(s.median).toBeNull();
      expect(s.stdDev).toBeNull();
      expect(s.min).toBeNull();
      expect(s.max).toBeNull();
    });

    it("single value → stdDev=0", () => {
      const s = summarizeColumn("single", [42]);
      expect(s.stdDev).toBe(0);
      expect(s.mean).toBe(42);
      expect(s.median).toBe(42);
    });
  });

  describe("computeDescriptiveStats", () => {
    const pimaSample: TypedDataset = {
      columns: ["pregnancies", "glucose", "bmi", "age"],
      types: ["number", "number", "number", "number"],
      rows: [
        [6, 148, 33.6, 50],
        [1, 85, 26.6, 31],
        [8, 183, 23.3, 32],
        [1, 89, 28.1, 21],
        [0, 137, 43.1, 33],
        [5, 116, 25.6, 30],
        [3, 78, 31.0, 26],
        [10, 115, 35.3, 29],
        [2, 197, 30.5, 53],
        [8, 125, 0.0, 54],
      ],
    };

    it("computes stats for Pima sample (10 rows, 4 columns)", () => {
      const stats = computeDescriptiveStats(pimaSample);
      expect(stats).toHaveLength(4);
      expect(stats[0].name).toBe("pregnancies");
      expect(stats[1].name).toBe("glucose");
      expect(stats[0].count).toBe(10);
      expect(stats[0].nullCount).toBe(0);
    });

    it("glucose mean ≈ 117.3", () => {
      const stats = computeDescriptiveStats(pimaSample);
      expect(stats[1].mean).toBeCloseTo(127.3, 1);
    });

    it("handles all-null column", () => {
      const ds: TypedDataset = {
        columns: ["empty"],
        types: ["number"],
        rows: [[null], [null], [null]],
      };
      const stats = computeDescriptiveStats(ds);
      expect(stats[0].mean).toBeNull();
      expect(stats[0].nullCount).toBe(3);
    });

    it("handles non-numeric column (string)", () => {
      const ds: TypedDataset = {
        columns: ["category"],
        types: ["string"],
        rows: [["a"], ["b"], ["a"]],
      };
      const stats = computeDescriptiveStats(ds);
      expect(stats[0].type).toBe("string");
      expect(stats[0].mean).toBeNull();
      expect(stats[0].uniqueCount).toBe(2);
    });
  });
});
