import { describe, it, expect } from "vitest";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import { AB161 } from "../../../src/agent-readiness/rules/AB161";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const mockSnap = (url: string, body?: string | null, status = 200): ResponseSnapshot => ({
  url,
  status,
  bodyHash: "abc123",
  bodySize: body?.length ?? 0,
  contentType: body ? "application/json" : "text/plain",
  resolvedIp: "93.184.216.34",
  fetchedAt: "2025-01-01T00:00:00Z",
  fetchTimeMs: 100,
  redirectChain: [],
  body,
  headers: {},
});

// homepage_meta snapshot body is JSON.stringify({ source, data }) per fetchHomepageMeta
const homepageSnap = (data: Record<string, unknown>): ResponseSnapshot =>
  mockSnap("https://example.com/", JSON.stringify({ source: "homepage-meta", data }));

const fullData = {
  aiAgentDiscovery: "https://example.com/llms.txt",
  aiAgentOnboarding: "https://example.com/skill.md",
  aiAgentDiscoveryReachable: true,
  aiAgentOnboardingReachable: true,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SLICE-125-1: AB-161 AI-Agent Discovery meta tags (ai_agent_discovery_meta)", () => {
  // ─── Rule definition ─────────────────────────────────────────────────────
  describe("rule definition", () => {
    it("rule definition is correct", () => {
      expect(AB161.rule_id).toBe("AB-161");
      expect(AB161.version).toBe("1.0.0");
      expect(AB161.check.type).toBe("semantic_validation");
      expect(AB161.check.semantic).toBe("ai_agent_discovery_meta");
      expect(AB161.check.sources).toEqual(["homepage_meta"]);
      expect(AB161.category).toBe("discovery");
      expect(AB161.severity).toBe("high");
      expect(AB161.counted_in_score).toBe(true);
      expect(AB161.name.length).toBeGreaterThan(3);
      expect(AB161.display_question).toBeDefined();
    });

    it("has a RULE_DESCRIPTIONS entry", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-161");
      expect(desc).toBeDefined();
      expect(desc!.title.length).toBeGreaterThan(3);
      expect(desc!.short_description.length).toBeGreaterThan(10);
    });
  });

  // ─── Checker outcomes ────────────────────────────────────────────────────
  describe("checker outcomes", () => {
    it("both meta tags present, valid URLs, reachable → found", () => {
      const snap = homepageSnap(fullData);
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("ai-agent-discovery");
      expect(result.detail).toContain("ai-agent-onboarding");
    });

    it("both present but discovery URL unreachable → partial", () => {
      const snap = homepageSnap({ ...fullData, aiAgentDiscoveryReachable: false });
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("unreachable");
    });

    it("both present but onboarding URL unreachable → partial", () => {
      const snap = homepageSnap({ ...fullData, aiAgentOnboardingReachable: false });
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("partial");
    });

    it("only ai-agent-discovery present → absent (one missing)", () => {
      const snap = homepageSnap({ ...fullData, aiAgentOnboarding: null, aiAgentOnboardingReachable: false });
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("ai-agent-onboarding");
    });

    it("only ai-agent-onboarding present → absent (one missing)", () => {
      const snap = homepageSnap({ ...fullData, aiAgentDiscovery: null, aiAgentDiscoveryReachable: false });
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("ai-agent-discovery");
    });

    it("neither meta tag present → absent", () => {
      const snap = homepageSnap({
        aiAgentDiscovery: null,
        aiAgentOnboarding: null,
        aiAgentDiscoveryReachable: false,
        aiAgentOnboardingReachable: false,
      });
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("Neither");
    });

    it("both present but invalid URL content → absent", () => {
      const snap = homepageSnap({ ...fullData, aiAgentDiscovery: "not-a-url", aiAgentOnboarding: "ftp://example.com/skill.md" });
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("invalid");
    });

    it("homepage_meta snapshot missing → no_source", () => {
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: null });
      expect(result.outcome).toBe("no_source");
    });

    it("homepage body not parseable as JSON → no_source", () => {
      const snap = mockSnap("https://example.com/", "not json");
      const result = SEMANTIC_CHECKERS["ai_agent_discovery_meta"]({ homepage_meta: snap });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── Determinism ─────────────────────────────────────────────────────────
  describe("Pure checker: deterministic", () => {
    it("same input → same result", () => {
      const sources = { homepage_meta: homepageSnap(fullData) };
      const r1 = SEMANTIC_CHECKERS["ai_agent_discovery_meta"](sources);
      const r2 = SEMANTIC_CHECKERS["ai_agent_discovery_meta"](sources);
      expect(r1).toEqual(r2);
    });
  });
});
