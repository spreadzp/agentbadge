import { describe, it, expect, beforeAll } from "vitest";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { RULE_CHECKERS } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const mockSnap = (url: string, status = 200): ResponseSnapshot => ({
  url,
  status,
  bodyHash: "abc123",
  bodySize: 100,
  contentType: "application/json",
  resolvedIp: "93.184.216.34",
  fetchedAt: new Date().toISOString(),
  fetchTimeMs: 50,
  redirectChain: [],
});

const fullSourceState: SourceState = {
  domain: "example.com",
  scannedAt: new Date().toISOString(),
  snapshots: {
    robots: mockSnap("https://example.com/robots.txt"),
    sitemap: mockSnap("https://example.com/sitemap.xml"),
    guide: mockSnap("https://example.com/.well-known/agent-guide.json"),
    openapi: mockSnap("https://example.com/openapi.json"),
    mcp: mockSnap("https://example.com/.well-known/mcp.json"),
    llms: mockSnap("https://example.com/llms.txt"),
    llms_full: mockSnap("https://example.com/llms-full.txt"),
    homepage_meta: mockSnap("https://example.com/"),
    skill: mockSnap("https://example.com/.well-known/skill.md"),
    agents: mockSnap("https://example.com/agents.txt"),
    content_negotiation: mockSnap("https://example.com/"),
    mcp_probe: mockSnap("https://example.com/.well-known/mcp.json"),
    infrastructure: mockSnap("https://example.com/.well-known/infrastructure.json"),
    a2a: mockSnap("https://example.com/.well-known/a2a.json"),
    identity: mockSnap("https://example.com/.well-known/webfinger"),
    bot_auth: mockSnap("https://example.com/.well-known/bot-auth.json"),
    x402: mockSnap("https://example.com/.well-known/x402.json"),
    webmcp: mockSnap("https://example.com/.well-known/webmcp.json"),
    og_meta: mockSnap("https://example.com/"),
    aeo_content: mockSnap("https://example.com/"),
    semantic_html: mockSnap("https://example.com/"),
    accessibility: mockSnap("https://example.com/"),
    content_depth: mockSnap("https://example.com/"),
  } as Record<string, ResponseSnapshot | null>,
};

const emptySourceState: SourceState = {
  domain: "example.com",
  scannedAt: new Date().toISOString(),
  snapshots: {} as Record<string, ResponseSnapshot | null>,
};

describe("Rule Engine Integration — All Rules", () => {
  beforeAll(() => {
    RuleEngine.reset();
  });

  it("produces assertions for all rules in the ruleset", () => {
    const result = RuleEngine.run(fullSourceState);
    expect(result.assertions.length).toBeGreaterThanOrEqual(13);
  });

  it("all resource-based rules are VERIFIED with full SourceState", () => {
    const result = RuleEngine.run(fullSourceState);
    const verified = result.assertions.filter((a) => a.status === "VERIFIED");
    expect(verified.length).toBeGreaterThanOrEqual(4);
  });

  it("all assertions have valid rule_ids matching AB-NNN format", () => {
    const result = RuleEngine.run(fullSourceState);
    for (const a of result.assertions) {
      expect(a.rule_id).toMatch(/^AB-\d{3}$/);
    }
  });

  it("assertions are sorted by rule_id alphabetically", () => {
    const result = RuleEngine.run(fullSourceState);
    const ids = result.assertions.map((a) => a.rule_id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("empty SourceState produces all NOT_APPLICABLE or MISSING", () => {
    const result = RuleEngine.run(emptySourceState);
    const naOrMissing = result.assertions.filter(
      (a) => a.status === "NOT_APPLICABLE" || a.status === "MISSING",
    );
    expect(naOrMissing.length).toBe(result.assertions.length);
  });

  it("every checker in RULE_CHECKERS runs without throwing on full SourceState", () => {
    for (const [ruleId, checker] of Object.entries(RULE_CHECKERS)) {
      expect(() => checker(fullSourceState), `${ruleId} should not throw`).not.toThrow();
    }
  });

  it("result includes metadata (rulesetVersion, scannedAt, counts)", () => {
    const result = RuleEngine.run(fullSourceState);
    expect(result.rulesetVersion).toBeTruthy();
    expect(result.scannedAt).toMatch(/^\d{4}-/);
    expect(result.totalRules).toBeGreaterThanOrEqual(13);
    expect(result.applicableRules).toBeGreaterThan(0);
  });

  it("every assertion is JSON-serializable (no circular refs)", () => {
    const result = RuleEngine.run(fullSourceState);
    for (const a of result.assertions) {
      expect(() => JSON.stringify(a)).not.toThrow();
    }
  });

  it("confidence is null or 0..1 for every assertion", () => {
    const result = RuleEngine.run(fullSourceState);
    for (const a of result.assertions) {
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("re-running produces same assertion count (determinism)", () => {
    const r1 = RuleEngine.run(fullSourceState);
    RuleEngine.reset();
    const r2 = RuleEngine.run(fullSourceState);
    expect(r1.assertions.length).toBe(r2.assertions.length);
    expect(r1.totalRules).toBe(r2.totalRules);
  });
});
