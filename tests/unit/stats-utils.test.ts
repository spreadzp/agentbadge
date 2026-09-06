/**
 * SLICE-103-3: Statistics utility tests.
 */

import { describe, it, expect } from "vitest";
import { mean, median, stddev, percentile, bucketize } from "../../src/agent-readiness/corpus/stats-utils";

describe("SLICE-103-3: stats-utils", () => {
  describe("mean", () => {
    it("computes mean of values", () => {
      expect(mean([10, 20, 30, 40, 50])).toBe(30);
    });

    it("returns 0 for empty array", () => {
      expect(mean([])).toBe(0);
    });

    it("returns the value for single element", () => {
      expect(mean([42])).toBe(42);
    });
  });

  describe("median", () => {
    it("computes median of odd-length array", () => {
      expect(median([10, 20, 30, 40, 50])).toBe(30);
    });

    it("computes median of even-length array (interpolated)", () => {
      expect(median([10, 20, 30, 40])).toBe(25);
    });

    it("returns 0 for empty array", () => {
      expect(median([])).toBe(0);
    });
  });

  describe("stddev", () => {
    it("computes population standard deviation", () => {
      expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.0, 5);
    });

    it("returns 0 for empty array", () => {
      expect(stddev([])).toBe(0);
    });

    it("returns 0 for identical values", () => {
      expect(stddev([5, 5, 5, 5])).toBe(0);
    });
  });

  describe("percentile", () => {
    it("computiles p50 (median) correctly", () => {
      expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it("computes p25 with linear interpolation", () => {
      // rank = 0.25 * 4 = 1.0 → index 1
      expect(percentile([1, 2, 3, 4, 5], 25)).toBe(2);
    });

    it("computes p75 with linear interpolation", () => {
      // rank = 0.75 * 4 = 3.0 → index 3
      expect(percentile([1, 2, 3, 4, 5], 75)).toBe(4);
    });

    it("computes p90 with linear interpolation", () => {
      // rank = 0.90 * 4 = 3.6 → 0.4 * index[3] + 0.6 * index[4]
      expect(percentile([1, 2, 3, 4, 5], 90)).toBeCloseTo(4.6, 5);
    });

    it("returns the value for single element", () => {
      expect(percentile([42], 50)).toBe(42);
    });

    it("returns 0 for empty array", () => {
      expect(percentile([], 50)).toBe(0);
    });
  });

  describe("bucketize", () => {
    it("buckets 72 into 70-80", () => {
      expect(bucketize(72, 10, 0, 100)).toBe("70-80");
    });

    it("buckets 0 into 0-10", () => {
      expect(bucketize(0, 10, 0, 100)).toBe("0-10");
    });

    it("buckets 100 into 90-100", () => {
      expect(bucketize(100, 10, 0, 100)).toBe("90-100");
    });

    it("buckets 5 into 0-10", () => {
      expect(bucketize(5, 10, 0, 100)).toBe("0-10");
    });

    it("clamps values below min", () => {
      expect(bucketize(-5, 10, 0, 100)).toBe("0-10");
    });
  });
});
