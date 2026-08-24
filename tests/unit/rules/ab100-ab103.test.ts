import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB100 } from "../../../src/agent-readiness/rules/AB100";
import { AB101 } from "../../../src/agent-readiness/rules/AB101";
import { AB102 } from "../../../src/agent-readiness/rules/AB102";
import { AB103 } from "../../../src/agent-readiness/rules/AB103";
import { RULE_CHECKERS } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function makeState(snaps: Record<string, ResponseSnapshot | null>): SourceState {
  return { domain: "example.com", scannedAt: new Date().toISOString(), snapshots: snaps };
}

function makeSnap(body: string, contentType = "application/json"): ResponseSnapshot {
  return {
    url: "https://example.com/",
    status: 200,
    bodyHash: "abc",
    bodySize: body.length,
    contentType,
    resolvedIp: null,
    fetchedAt: new Date().toISOString(),
    fetchTimeMs: 0,
    redirectChain: [],
    body,
  };
}

const contentDepthBody = JSON.stringify({
  source: "content-depth",
  data: { wordCount: 450, paragraphCount: 5, headingCount: 3, headingHierarchy: [] },
});

const semanticHtmlBody = JSON.stringify({
  source: "semantic-html",
  data: { hasDefinitionList: false, definitionListCount: 0, hasArticleTag: true, hasTimeTag: true, hasNavTag: true, hasBreadcrumbs: true, hasFigureCaption: false },
});

const mcpProbeBody = JSON.stringify({
  source: "mcp-probe",
  data: {
    initialize: { status: 200 },
    toolsList: { status: 200, tools: [{ name: "check_compliance" }, { name: "scan" }] },
    toolsCall: { status: 200 },
    sse: { status: 200, supported: true },
    cors: { status: 200, allowOrigin: "*" },
  },
});

const openapiBody = JSON.stringify({
  openapi: "3.0.0",
  paths: { "/api/scan": {}, "/api/report": {}, "/api/health": {} },
});

describe("SLICE-75-6: Content & Parity Rules AB-100, AB-101, AB-102, AB-103", () => {
  // ─── AB-100: Service page content depth ───────────────────────────────────────
  describe("AB-100: Service page content depth", () => {
    it("has correct metadata", () => {
      expect(AB100.rule_id).toBe("AB-100");
      expect(AB100.name).toBe("Service page content depth");
      expect(AB100.category).toBe("seo_aeo");
      expect(AB100.severity).toBe("low");
      expect(AB100.counted_in_score).toBe(true);
      expect(AB100.check.type).toBe("content_parse");
      expect(AB100.check.sources).toContain("content_depth");
      expect(AB100.check.match_keys).toContain("wordCount");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB100);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-100");
      expect(rule).toBeDefined();
      expect(rule).toBe(AB100);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-100"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-100");
      expect(desc).toBeDefined();
      expect(desc?.title).toBe("Service page content depth");
    });

    it("returns evidence when content_depth snapshot exists", () => {
      const state = makeState({ content_depth: makeSnap(contentDepthBody) });
      const evidence = RULE_CHECKERS["AB-100"]!(state);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].type).toBe("http");
    });

    it("returns empty when content_depth snapshot is missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-100"]!(state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-101: Breadcrumb navigation on service pages ───────────────────────────
  describe("AB-101: Breadcrumb navigation on service pages", () => {
    it("has correct metadata", () => {
      expect(AB101.rule_id).toBe("AB-101");
      expect(AB101.name).toBe("Breadcrumb navigation on service pages");
      expect(AB101.category).toBe("seo_aeo");
      expect(AB101.severity).toBe("low");
      expect(AB101.counted_in_score).toBe(true);
      expect(AB101.check.type).toBe("content_parse");
      expect(AB101.check.sources).toContain("semantic_html");
      expect(AB101.check.match_keys).toContain("hasBreadcrumbs");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB101);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-101");
      expect(rule).toBeDefined();
      expect(rule).toBe(AB101);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-101"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-101");
      expect(desc).toBeDefined();
      expect(desc?.title).toBe("Breadcrumb navigation on service pages");
    });

    it("returns evidence when semantic_html snapshot exists", () => {
      const state = makeState({ semantic_html: makeSnap(semanticHtmlBody) });
      const evidence = RULE_CHECKERS["AB-101"]!(state);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].type).toBe("http");
    });

    it("returns empty when semantic_html snapshot is missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-101"]!(state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-102: MCP tools and REST endpoints parity ──────────────────────────────
  describe("AB-102: MCP tools and REST endpoints parity", () => {
    it("has correct metadata", () => {
      expect(AB102.rule_id).toBe("AB-102");
      expect(AB102.name).toBe("MCP tools and REST endpoints parity");
      expect(AB102.category).toBe("webmcp");
      expect(AB102.severity).toBe("medium");
      expect(AB102.counted_in_score).toBe(true);
      expect(AB102.check.type).toBe("cross_evidence");
      expect(AB102.check.sources).toContain("mcp_probe");
      expect(AB102.check.sources).toContain("openapi");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB102);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-102");
      expect(rule).toBeDefined();
      expect(rule).toBe(AB102);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-102"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-102");
      expect(desc).toBeDefined();
      expect(desc?.title).toBe("MCP tools and REST endpoints parity");
    });

    it("returns cross evidence when both snapshots exist", () => {
      const state = makeState({
        mcp_probe: makeSnap(mcpProbeBody),
        openapi: makeSnap(openapiBody),
      });
      const evidence = RULE_CHECKERS["AB-102"]!(state);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].type).toBe("cross");
    });

    it("returns http evidence when only mcp_probe exists", () => {
      const state = makeState({ mcp_probe: makeSnap(mcpProbeBody) });
      const evidence = RULE_CHECKERS["AB-102"]!(state);
      expect(evidence).toHaveLength(1);
    });

    it("returns http evidence when only openapi exists", () => {
      const state = makeState({ openapi: makeSnap(openapiBody) });
      const evidence = RULE_CHECKERS["AB-102"]!(state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty when neither snapshot exists", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-102"]!(state);
      expect(evidence).toHaveLength(0);
    });

    it("detects parity conflict when mcp tools < 50% of openapi endpoints", () => {
      const fewToolsBody = JSON.stringify({
        source: "mcp-probe",
        data: { toolsList: { status: 200, tools: [{ name: "scan" }] } },
      });
      const manyEndpointsBody = JSON.stringify({
        openapi: "3.0.0",
        paths: { "/a": {}, "/b": {}, "/c": {}, "/d": {}, "/e": {}, "/f": {} },
      });
      const state = makeState({
        mcp_probe: makeSnap(fewToolsBody),
        openapi: makeSnap(manyEndpointsBody),
      });
      const evidence = RULE_CHECKERS["AB-102"]!(state);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].type).toBe("cross");
    });
  });

  // ─── AB-103: check_compliance MCP tool available ──────────────────────────────
  describe("AB-103: check_compliance MCP tool available", () => {
    it("has correct metadata", () => {
      expect(AB103.rule_id).toBe("AB-103");
      expect(AB103.name).toBe("check_compliance MCP tool available");
      expect(AB103.category).toBe("webmcp");
      expect(AB103.severity).toBe("low");
      expect(AB103.counted_in_score).toBe(true);
      expect(AB103.check.type).toBe("json_rpc");
      expect(AB103.check.sources).toContain("mcp_probe");
      expect(AB103.check.match_keys).toContain("check_compliance");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB103);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-103");
      expect(rule).toBeDefined();
      expect(rule).toBe(AB103);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-103"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-103");
      expect(desc).toBeDefined();
      expect(desc?.title).toBe("check_compliance MCP tool available");
    });

    it("returns evidence when mcp_probe snapshot exists", () => {
      const state = makeState({ mcp_probe: makeSnap(mcpProbeBody) });
      const evidence = RULE_CHECKERS["AB-103"]!(state);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].type).toBe("http");
    });

    it("returns empty when mcp_probe snapshot is missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-103"]!(state);
      expect(evidence).toHaveLength(0);
    });
  });
});
