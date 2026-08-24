import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB115 } from "../../../src/agent-readiness/rules/AB115";
import { AB116 } from "../../../src/agent-readiness/rules/AB116";
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

describe("SLICE-75-4: MCP Namespacing Rules AB-115 and AB-116", () => {
  // ─── AB-115: MCP namespace-based tool isolation ────────────────────────────────
  describe("AB-115: MCP namespace-based tool isolation", () => {
    it("has correct metadata", () => {
      expect(AB115.rule_id).toBe("AB-115");
      expect(AB115.name).toBe("MCP namespace-based tool isolation");
      expect(AB115.category).toBe("webmcp");
      expect(AB115.severity).toBe("medium");
      expect(AB115.counted_in_score).toBe(true);
      expect(AB115.check.type).toBe("json_rpc");
      expect(AB115.check.sources).toContain("mcp_probe");
      expect(AB115.check.match_keys).toContain("namespaced_tools");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB115);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-115");
      expect(found).toBeDefined();
      expect(found).toBe(AB115);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-115"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-115");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("MCP namespace-based tool isolation");
    });

    it("detects namespaced tools in mcp_probe snapshot", () => {
      const mcpProbeBody = JSON.stringify({
        source: "mcp-probe",
        data: {
          initialize: { status: 200 },
          toolsList: {
            status: 200,
            tools: [
              { name: "passport.request" },
              { name: "wallet.submit" },
              { name: "health.check" },
            ],
          },
          toolsCall: { status: 200 },
          sse: { status: 200, supported: true },
          cors: { status: 200, allowOrigin: "*" },
        },
      });
      const state = makeState({
        mcp_probe: makeSnap(mcpProbeBody),
      });
      const evidence = RULE_CHECKERS["AB-115"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns evidence when tools have no namespace prefixes", () => {
      const mcpProbeBody = JSON.stringify({
        source: "mcp-probe",
        data: {
          initialize: { status: 200 },
          toolsList: {
            status: 200,
            tools: [
              { name: "request" },
              { name: "submit" },
              { name: "check" },
            ],
          },
          toolsCall: { status: 200 },
          sse: { status: 200, supported: true },
          cors: { status: 200, allowOrigin: "*" },
        },
      });
      const state = makeState({
        mcp_probe: makeSnap(mcpProbeBody),
      });
      const evidence = RULE_CHECKERS["AB-115"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns evidence on invalid JSON body", () => {
      const state = makeState({
        mcp_probe: makeSnap("not json"),
      });
      const evidence = RULE_CHECKERS["AB-115"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-115"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-116: Well-known MCP descriptor ─────────────────────────────────────────
  describe("AB-116: Well-known MCP descriptor", () => {
    it("has correct metadata", () => {
      expect(AB116.rule_id).toBe("AB-116");
      expect(AB116.name).toBe("Well-known MCP descriptor");
      expect(AB116.category).toBe("webmcp");
      expect(AB116.severity).toBe("medium");
      expect(AB116.counted_in_score).toBe(true);
      expect(AB116.check.type).toBe("http_fetch");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB116);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-116");
      expect(found).toBeDefined();
      expect(found).toBe(AB116);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-116"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-116");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Well-known MCP descriptor");
    });

    it("returns evidence when mcp snapshot exists", () => {
      const state = makeState({
        mcp: makeSnap(JSON.stringify({ server: { name: "my-mcp", version: "1.0" } })),
      });
      const evidence = RULE_CHECKERS["AB-116"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-116"](state);
      expect(evidence).toHaveLength(0);
    });
  });
});
