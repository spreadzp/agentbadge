import { describe, it, expect } from "vitest";
import { computeGrade } from "../../../src/agent-readiness/scoring/grade-computer";

describe("computeGrade", () => {
  it("returns A+ for score 95-100", () => {
    expect(computeGrade(95)).toBe("A+");
    expect(computeGrade(100)).toBe("A+");
    expect(computeGrade(97)).toBe("A+");
  });

  it("returns A for score 90-94", () => {
    expect(computeGrade(90)).toBe("A");
    expect(computeGrade(94)).toBe("A");
    expect(computeGrade(92)).toBe("A");
  });

  it("returns B+ for score 85-89", () => {
    expect(computeGrade(85)).toBe("B+");
    expect(computeGrade(89)).toBe("B+");
  });

  it("returns B for score 80-84", () => {
    expect(computeGrade(80)).toBe("B");
    expect(computeGrade(84)).toBe("B");
  });

  it("returns C+ for score 75-79", () => {
    expect(computeGrade(75)).toBe("C+");
    expect(computeGrade(79)).toBe("C+");
  });

  it("returns C for score 70-74", () => {
    expect(computeGrade(70)).toBe("C");
    expect(computeGrade(74)).toBe("C");
  });

  it("returns D for score 60-69", () => {
    expect(computeGrade(60)).toBe("D");
    expect(computeGrade(69)).toBe("D");
    expect(computeGrade(65)).toBe("D");
  });

  it("returns F for score 0-59", () => {
    expect(computeGrade(0)).toBe("F");
    expect(computeGrade(59)).toBe("F");
    expect(computeGrade(30)).toBe("F");
  });

  it("handles edge cases", () => {
    expect(computeGrade(100)).toBe("A+");
    expect(computeGrade(0)).toBe("F");
  });
});
