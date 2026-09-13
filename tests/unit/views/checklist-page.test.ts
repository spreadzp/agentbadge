import { describe, it, expect } from "vitest";
import { ChecklistPage } from "../../../src/views/checklist-page";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";
import { CORE_RULE_IDS } from "../../../src/agent-readiness/core-rules";

describe("SLICE-114-2: ChecklistPage view component", () => {
  const html = ChecklistPage().toString();

  it("returns a non-empty string", () => {
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(1000);
  });

  it("contains 'Agent Readiness Checklist' title", () => {
    expect(html).toContain("Agent Readiness Checklist");
  });

  it("contains all rule IDs as stable anchors", () => {
    for (const rule of RULE_DESCRIPTIONS) {
      expect(html).toContain(`id="${rule.rule_id}"`);
    }
  });

  it("contains 'Core' badge for core rules", () => {
    for (const id of CORE_RULE_IDS) {
      const rule = RULE_DESCRIPTIONS.find((r) => r.rule_id === id);
      if (rule) {
        // Core badge should appear near the rule anchor
        const anchorIdx = html.indexOf(`id="${id}"`);
        expect(anchorIdx).toBeGreaterThan(-1);
        const snippet = html.slice(anchorIdx, anchorIdx + 1000);
        expect(snippet).toContain("Core");
      }
    }
  });

  it("contains links to /rules/AB-XXX for each rule", () => {
    for (const rule of RULE_DESCRIPTIONS) {
      expect(html).toContain(`href="/rules/${rule.rule_id}"`);
    }
  });

  it("contains all 4 pillar labels", () => {
    expect(html).toContain("Discovery");
    expect(html).toContain("Understandability");
    expect(html).toContain("Executability");
    expect(html).toContain("Verifiability");
  });

  it("contains editorial intro content", () => {
    expect(html).toContain("How to Use This Checklist");
    expect(html).toContain("How Scoring Works");
    expect(html).toContain("Core Rules vs Advanced Rules");
  });

  it("contains progress summary with rule count", () => {
    expect(html).toContain(`${RULE_DESCRIPTIONS.length} rules`);
  });

  it("contains core rule count in summary", () => {
    expect(html).toContain(`${CORE_RULE_IDS.length} core rules`);
  });

  it("contains collapsible details elements", () => {
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
  });

  it("contains CTA link to scanner", () => {
    expect(html).toContain('href="/#scan"');
    expect(html).toContain("Scan Your Site");
  });

  it("contains prose styling for intro", () => {
    expect(html).toContain("prose");
    expect(html).toContain("prose-invert");
  });

  it("contains Layout shell (DOCTYPE, html, head, body)", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("<body");
  });
});
