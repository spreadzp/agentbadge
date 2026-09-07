import { describe, it, expect } from "vitest";
import { getRuleDescription, RuleDetailPage } from "../../src/views/rule-detail-page";

describe("SLICE-115-4: HTML rule detail page enhancements", () => {
  const desc = getRuleDescription("AB-001")!;
  const html = RuleDetailPage(desc).toString();

  it("contains severity badge text", () => {
    expect(html).toContain("Severity:");
    expect(html).toMatch(/Severity:\s*(critical|high|medium|low)/);
  });

  it("contains JSON alternate link in head", () => {
    expect(html).toContain('rel="alternate"');
    expect(html).toContain('type="application/json"');
    expect(html).toContain('/rules/AB-001.json');
  });

  it("contains machine-readable section with JSON link", () => {
    expect(html).toContain("Machine-Readable");
    expect(html).toContain('/rules/AB-001.json');
  });

  it("severity badge has correct styling class", () => {
    expect(html).toContain("rounded-full");
    expect(html).toContain("font-mono");
    expect(html).toContain("uppercase");
  });
});
