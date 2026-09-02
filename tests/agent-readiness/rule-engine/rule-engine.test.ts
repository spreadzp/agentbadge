import { describe, it, expect, beforeEach } from "vitest";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const mockSnapshot = (overrides?: Partial<ResponseSnapshot>): ResponseSnapshot => ({
  url: "https://example.com/test",
  status: 200,
  bodyHash: "abc123",
  bodySize: 100,
  contentType: "text/plain",
  resolvedIp: "93.184.216.34",
  fetchedAt: new Date().toISOString(),
  fetchTimeMs: 50,
  redirectChain: [],
  ...overrides,
});

const mockSourceState = (snapshots?: Partial<Record<string, ResponseSnapshot | null>>): SourceState => ({
  domain: "example.com",
  scannedAt: new Date().toISOString(),
  snapshots: {
    robots: null,
    sitemap: null,
    guide: null,
    openapi: null,
    mcp: null,
    ...snapshots,
  } as Record<string, ResponseSnapshot | null>,
});

beforeEach(() => {
  RuleEngine.reset();
});

describe("RuleEngine", () => {
  it("run() returns assertions for all rules", () => {
    const result = RuleEngine.run(mockSourceState());

    expect(result.assertions.length).toBeGreaterThanOrEqual(13);
    expect(result.totalRules).toBeGreaterThanOrEqual(13);
  });

  it("assertions are ordered by rule_id", () => {
    const result = RuleEngine.run(mockSourceState());
    const ids = result.assertions.map((a) => a.rule_id);

    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("rules with no matching snapshot produce NOT_APPLICABLE", () => {
    const result = RuleEngine.run(mockSourceState());

    const naAssertions = result.assertions.filter((a) => a.status === "NOT_APPLICABLE");
    expect(naAssertions.length).toBeGreaterThan(0);
  });

  it("robots.txt rule produces VERIFIED when robots snapshot exists", () => {
    const state = mockSourceState({
      robots: mockSnapshot({ url: "https://example.com/robots.txt", status: 200 }),
    });
    const result = RuleEngine.run(state);

    const robotsAssertion = result.assertions.find((a) => a.rule_id === "AB-001");
    expect(robotsAssertion).toBeDefined();
    expect(robotsAssertion!.status).toBe("VERIFIED");
  });

  it("sitemap.xml rule produces VERIFIED when sitemap snapshot exists", () => {
    const state = mockSourceState({
      sitemap: mockSnapshot({ url: "https://example.com/sitemap.xml", status: 200 }),
    });
    const result = RuleEngine.run(state);

    const sitemapAssertion = result.assertions.find((a) => a.rule_id === "AB-002");
    expect(sitemapAssertion).toBeDefined();
    expect(sitemapAssertion!.status).toBe("VERIFIED");
  });

  it("agent-guide rule produces VERIFIED when guide snapshot exists", () => {
    const state = mockSourceState({
      guide: mockSnapshot({ url: "https://example.com/.well-known/agent-guide.json", status: 200 }),
    });
    const result = RuleEngine.run(state);

    const guideAssertion = result.assertions.find((a) => a.rule_id === "AB-003");
    expect(guideAssertion).toBeDefined();
    expect(guideAssertion!.status).toBe("VERIFIED");
  });

  it("openapi rule produces VERIFIED when openapi snapshot exists", () => {
    const state = mockSourceState({
      openapi: mockSnapshot({ url: "https://example.com/openapi.json", status: 200 }),
    });
    const result = RuleEngine.run(state);

    const openapiAssertion = result.assertions.find((a) => a.rule_id === "AB-004");
    expect(openapiAssertion).toBeDefined();
    expect(openapiAssertion!.status).toBe("VERIFIED");
  });

  it("custom applicability predicate overrides default", () => {
    RuleEngine.registerApplicability("AB-001", () => false);
    const state = mockSourceState({
      robots: mockSnapshot({ url: "https://example.com/robots.txt", status: 200 }),
    });
    const result = RuleEngine.run(state);

    const robotsAssertion = result.assertions.find((a) => a.rule_id === "AB-001");
    expect(robotsAssertion!.status).toBe("NOT_APPLICABLE");
  });

  it("result includes rulesetVersion and scannedAt", () => {
    const result = RuleEngine.run(mockSourceState());

    expect(result.rulesetVersion).toBeTruthy();
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("applicableRules counts only applicable ones", () => {
    const state = mockSourceState({
      robots: mockSnapshot({ url: "https://example.com/robots.txt", status: 200 }),
    });
    const result = RuleEngine.run(state);

    expect(result.applicableRules).toBeGreaterThan(0);
    expect(result.applicableRules).toBeLessThanOrEqual(13);
  });

  it("every assertion has all required fields", () => {
    const result = RuleEngine.run(mockSourceState());

    for (const a of result.assertions) {
      expect(a.rule_id).toMatch(/^AB-/);
      expect(a.rule_version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(a.status).toMatch(/^(VERIFIED|INFERRED|CONFLICT|GAP|NOT_APPLICABLE)$/);
      expect(Array.isArray(a.evidence)).toBe(true);
      expect(typeof a.confidence).toBe("number");
      expect(a.timestamp).toBeTruthy();
      expect(typeof a.reason).toBe("string");
    }
  });
});
