import { describe, it, expect } from "vitest";
import {
  checkAb001, checkAb002, checkAb003, checkAb004, checkAb005,
  checkAb006, checkAb007, checkAb008, checkAb009, checkAb010,
  checkAb011, checkAb012, checkAb013, RULE_CHECKERS,
} from "../../../src/agent-readiness/rule-engine/rule-checkers";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const mockSnap = (overrides?: Partial<ResponseSnapshot>): ResponseSnapshot => ({
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

const mockState = (snaps?: Partial<Record<string, ResponseSnapshot | null>>): SourceState => ({
  domain: "example.com",
  scannedAt: new Date().toISOString(),
  snapshots: { robots: null, sitemap: null, guide: null, openapi: null, mcp: null, ...snaps } as Record<string, ResponseSnapshot | null>,
});

describe("Rule Checkers AB-001..AB-013", () => {
  // AB-001: robots.txt exists
  it("AB-001 returns robots evidence when snapshot exists", () => {
    const state = mockState({ robots: mockSnap({ url: "https://example.com/robots.txt" }) });
    const evidence = checkAb001(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("robots");
  });

  it("AB-001 returns empty when no robots snapshot", () => {
    expect(checkAb001(mockState())).toEqual([]);
  });

  // AB-002: sitemap.xml exists
  it("AB-002 returns sitemap evidence when snapshot exists", () => {
    const state = mockState({ sitemap: mockSnap({ url: "https://example.com/sitemap.xml" }) });
    const evidence = checkAb002(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("sitemap");
  });

  it("AB-002 returns empty when no sitemap snapshot", () => {
    expect(checkAb002(mockState())).toEqual([]);
  });

  // AB-003: agent-guide.json discoverable
  it("AB-003 returns http evidence when guide snapshot exists", () => {
    const state = mockState({ guide: mockSnap({ url: "https://example.com/.well-known/agent-guide.json" }) });
    const evidence = checkAb003(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("http");
  });

  it("AB-003 returns empty when no guide snapshot", () => {
    expect(checkAb003(mockState())).toEqual([]);
  });

  // AB-004: OpenAPI spec present
  it("AB-004 returns openapi evidence when snapshot exists", () => {
    const state = mockState({ openapi: mockSnap({ url: "https://example.com/openapi.json" }) });
    const evidence = checkAb004(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("openapi");
  });

  it("AB-004 returns empty when no openapi snapshot", () => {
    expect(checkAb004(mockState())).toEqual([]);
  });

  // AB-005: agent-guide.json schema-valid
  it("AB-005 returns http evidence when guide exists", () => {
    const state = mockState({ guide: mockSnap({ url: "https://example.com/.well-known/agent-guide.json" }) });
    const evidence = checkAb005(state);
    expect(evidence).toHaveLength(1);
  });

  it("AB-005 returns empty when no guide", () => {
    expect(checkAb005(mockState())).toEqual([]);
  });

  // AB-006: robots.txt allows User-agent: *
  it("AB-006 returns robots evidence when robots exists", () => {
    const state = mockState({ robots: mockSnap({ url: "https://example.com/robots.txt" }) });
    const evidence = checkAb006(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("robots");
  });

  it("AB-006 returns empty when no robots", () => {
    expect(checkAb006(mockState())).toEqual([]);
  });

  // AB-007: guide↔openapi consistency
  it("AB-007 returns both guide and openapi evidence when both exist", () => {
    const state = mockState({
      guide: mockSnap({ url: "https://example.com/.well-known/agent-guide.json" }),
      openapi: mockSnap({ url: "https://example.com/openapi.json" }),
    });
    const evidence = checkAb007(state);
    expect(evidence).toHaveLength(2);
  });

  it("AB-007 returns only guide when openapi missing", () => {
    const state = mockState({ guide: mockSnap() });
    expect(checkAb007(state)).toHaveLength(1);
  });

  it("AB-007 returns empty when neither exists", () => {
    expect(checkAb007(mockState())).toEqual([]);
  });

  // AB-008: auth declared
  it("AB-008 returns openapi evidence when exists", () => {
    const state = mockState({ openapi: mockSnap() });
    expect(checkAb008(state)).toHaveLength(1);
  });

  it("AB-008 returns empty when no openapi", () => {
    expect(checkAb008(mockState())).toEqual([]);
  });

  // AB-009: capability coverage
  it("AB-009 returns http evidence when guide exists", () => {
    const state = mockState({ guide: mockSnap() });
    expect(checkAb009(state)).toHaveLength(1);
  });

  it("AB-009 returns empty when no guide", () => {
    expect(checkAb009(mockState())).toEqual([]);
  });

  // AB-010: pricing machine-readable
  it("AB-010 returns evidence from both guide and openapi", () => {
    const state = mockState({ guide: mockSnap(), openapi: mockSnap() });
    expect(checkAb010(state)).toHaveLength(2);
  });

  it("AB-010 returns empty when neither exists", () => {
    expect(checkAb010(mockState())).toEqual([]);
  });

  // AB-011: rate limits declared
  it("AB-011 returns openapi evidence when exists", () => {
    const state = mockState({ openapi: mockSnap() });
    expect(checkAb011(state)).toHaveLength(1);
  });

  it("AB-011 returns empty when no openapi", () => {
    expect(checkAb011(mockState())).toEqual([]);
  });

  // AB-012: structured error schema
  it("AB-012 returns openapi evidence when exists", () => {
    const state = mockState({ openapi: mockSnap() });
    expect(checkAb012(state)).toHaveLength(1);
  });

  it("AB-012 returns empty when no openapi", () => {
    expect(checkAb012(mockState())).toEqual([]);
  });

  // AB-013: owner verification (passive)
  it("AB-013 returns http evidence when guide exists", () => {
    const state = mockState({ guide: mockSnap() });
    expect(checkAb013(state)).toHaveLength(1);
  });

  it("AB-013 returns empty when no guide", () => {
    expect(checkAb013(mockState())).toEqual([]);
  });

  // Registry completeness
  it("RULE_CHECKERS has at least 13 checkers", () => {
    const ids = Object.keys(RULE_CHECKERS);
    expect(ids.length).toBeGreaterThanOrEqual(13);
    expect(ids).toContain("AB-001");
    expect(ids).toContain("AB-013");
  });

  it("every checker is a function", () => {
    for (const [id, checker] of Object.entries(RULE_CHECKERS)) {
      expect(typeof checker).toBe("function");
    }
  });
});
