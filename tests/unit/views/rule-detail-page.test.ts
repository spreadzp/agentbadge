import { describe, it, expect } from "vitest";
import { RuleDetailPage, getRuleDescription } from "../../../src/views/rule-detail-page";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";

describe("SLICE-94-11: RuleDetailPage — evidence expected line", () => {
  it("getRuleDescription returns a rule by id", () => {
    const rule = getRuleDescription("AB-001");
    expect(rule).toBeDefined();
    expect(rule?.rule_id).toBe("AB-001");
  });

  it("renders 'Evidence expected' section heading", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    expect(html).toContain("Evidence expected");
  });

  it("renders evidence type badges", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    expect(html).toContain("http");
  });

  it("renders source class label from hierarchy", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    expect(html).toContain("Source:");
  });

  it("renders evidence section between 'Why it matters' and 'What's wrong'", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    const whyIdx = html.indexOf("Why it matters");
    const evidenceIdx = html.indexOf("Evidence expected");
    const wrongIdx = html.indexOf("<h3 class=\"font-semibold text-rose-300\">What's wrong</h3>");
    expect(whyIdx).toBeGreaterThan(-1);
    expect(evidenceIdx).toBeGreaterThan(-1);
    expect(wrongIdx).toBeGreaterThan(-1);
    expect(whyIdx).toBeLessThan(evidenceIdx);
    expect(evidenceIdx).toBeLessThan(wrongIdx);
  });
});
