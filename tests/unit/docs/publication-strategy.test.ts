import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("SLICE-119-3: External Publication Strategy doc", () => {
  const docPath = join(process.cwd(), "docs/STRATEGY/external-publication-strategy.md");
  let content: string;

  it("file exists at docs/STRATEGY/external-publication-strategy.md", () => {
    content = readFileSync(docPath, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("contains 'Platform Priorities' section", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    expect(content).toContain("Platform Priorities");
  });

  it("contains 'Canonical URL Rules' section", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    expect(content).toContain("Canonical URL Rules");
  });

  it("contains 'Publication Cadence' section", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    expect(content).toContain("Publication Cadence");
  });

  it("contains all 9 blog article titles in the mapping table", () => {
    if (!content) content = readFileSync(docPath, "utf-8");
    const titles = [
      "What Is Agent Readiness?",
      "SEO vs Agent Readiness",
      "The Web Is Becoming Agentic",
      "From SEO to GEO to Agent Readiness",
      "Why AI Agents Fail to Use APIs",
      "What Does an AI Agent Need to Understand an API?",
      "Why Your OpenAPI Spec Isn't Enough",
      "How Do You Measure Agent Readiness?",
      "Inside an Agent Readiness Scanner",
    ];
    for (const title of titles) {
      expect(content).toContain(title);
    }
  });
});
