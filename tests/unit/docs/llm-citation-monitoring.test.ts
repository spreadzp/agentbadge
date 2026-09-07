import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("SLICE-119-4: LLM Citation Monitoring doc", () => {
  const docPath = join(process.cwd(), "docs/STRATEGY/llm-citation-monitoring.md");
  let content: string;

  it("file exists at docs/STRATEGY/llm-citation-monitoring.md", () => {
    content = readFileSync(docPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("contains 'Target Questions' section", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    expect(content).toContain("Target Questions");
  });

  it("contains 'Scoring' section", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    expect(content).toContain("Scoring");
  });

  it("contains 'Google Alerts Setup' section", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    expect(content).toContain("Google Alerts Setup");
  });

  it("contains 'Monthly Review Cadence' section", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    expect(content).toContain("Monthly Review Cadence");
  });

  it("contains at least 10 target questions", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    const numberedQuestions = content.match(/^\d+\.\s/gm) ?? [];
    expect(numberedQuestions.length).toBeGreaterThanOrEqual(10);
  });
});
