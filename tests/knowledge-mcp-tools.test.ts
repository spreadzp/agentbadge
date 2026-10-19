/**
 * SLICE-201-8 (EPIC-201, track B): MCP knowledge tools — search_knowledge and
 * get_knowledge_object, so an agent in an MCP client finds AgentBadge
 * articles/rules/concepts and acts without leaving MCP (D-201-11, D-201-16/17,
 * D-201-21 relation-aware ranking via the 201-14 index).
 *
 *   search_knowledge(query) → {results:[{id,type,title,ref,status?,score}]}
 *     ranking: exact slug/tag > text (title/desc/qa) > relation edges
 *   get_knowledge_object(id) → full object:
 *     article:<slug> | <slug> → Knowledge Object v1 (201-5 format)
 *     rule:<rule_id>        → RuleDescription from the rules registry
 *     concept:<id>          → knowledge-map node (v1.3.0, slug refs)
 *     unknown               → isError contract (like board_* tools)
 */
import { describe, expect, it, beforeAll } from "vitest";
import { handleHttpToolCall, listTools } from "@agentbadge/mcp";
import { registerKnowledgeTools } from "../src/mcp/knowledge-tools";

function toolJson(result: {
  content: { type: string; text?: string }[];
  isError?: boolean;
}) {
  const text = result.content[0]?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text!);
}

beforeAll(() => {
  registerKnowledgeTools();
});

describe("tool registration", () => {
  it("search_knowledge and get_knowledge_object are advertised", () => {
    const tools = listTools().map((t) => t.name);
    expect(tools).toContain("search_knowledge");
    expect(tools).toContain("get_knowledge_object");
  });
});

describe("search_knowledge", () => {
  it("'agent readiness' → what-is-agent-readiness in top results", async () => {
    const r = await handleHttpToolCall("search_knowledge", {
      query: "agent readiness",
    });
    const body = toolJson(r);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    const top = body.results.slice(0, 3).map((x: { id: string }) => x.id);
    expect(top).toContain("article:what-is-agent-readiness");
    const hit = body.results.find(
      (x: { id: string }) => x.id === "article:what-is-agent-readiness",
    );
    expect(hit.ref).toBe("/blog/what-is-agent-readiness.json");
    expect(hit.status).toBe("LIVE");
    expect(typeof hit.score).toBe("number");
  });

  it("exact slug match outranks text hits", async () => {
    const r = await handleHttpToolCall("search_knowledge", {
      query: "arc-c29-task-board",
    });
    const body = toolJson(r);
    expect(body.results[0].id).toBe("article:arc-c29-task-board");
  });

  it("tag query finds articles by tag", async () => {
    const r = await handleHttpToolCall("search_knowledge", {
      query: "x402",
    });
    const body = toolJson(r);
    const ids = body.results.map((x: { id: string }) => x.id);
    expect(ids).toContain("article:arc-c15-x402-bazaar");
  });

  it("relation search: capability query finds arc-c29 via index edges", async () => {
    // 'task-discovery' is a capability entity — no article text mentions it,
    // so the hit must come through 201-14 edges (D-201-21).
    const r = await handleHttpToolCall("search_knowledge", {
      query: "task discovery",
    });
    const body = toolJson(r);
    const ids = body.results.map((x: { id: string }) => x.id);
    expect(ids).toContain("article:arc-c29-task-board");
  });

  it("rules appear in results for scanner-ish queries", async () => {
    const r = await handleHttpToolCall("search_knowledge", {
      query: "openapi",
    });
    const body = toolJson(r);
    const ruleHit = body.results.find((x: { type: string }) => x.type === "rule");
    expect(ruleHit).toBeDefined();
    expect(ruleHit.id).toMatch(/^rule:/);
  });

  it("empty/garbage query → structured empty response, not an error", async () => {
    for (const query of ["", "   ", "zzzqqqxxx"]) {
      const r = await handleHttpToolCall("search_knowledge", { query });
      expect(r.isError).toBeUndefined();
      const body = toolJson(r);
      expect(Array.isArray(body.results)).toBe(true);
    }
  });
});

describe("get_knowledge_object", () => {
  it("article:<slug> → Knowledge Object v1 (201-5 format)", async () => {
    const r = await handleHttpToolCall("get_knowledge_object", {
      id: "article:arc-c29-task-board",
    });
    const body = toolJson(r);
    expect(body.type).toBe("article");
    expect(body.slug).toBe("arc-c29-task-board");
    expect(body.status).toBe("LIVE");
    expect(Array.isArray(body.claims)).toBe(true);
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.economicContext?.endpoints?.board).toBeDefined();
    expect(body.markdownUrl).toContain("arc-c29-task-board");
  });

  it("bare slug resolves to article too", async () => {
    const r = await handleHttpToolCall("get_knowledge_object", {
      id: "what-is-agent-readiness",
    });
    const body = toolJson(r);
    expect(body.type).toBe("article");
    expect(body.slug).toBe("what-is-agent-readiness");
  });

  it("rule:<id> → RuleDescription from the registry", async () => {
    const r = await handleHttpToolCall("get_knowledge_object", {
      id: "rule:AB-039",
    });
    expect(r.isError).toBeUndefined();
    const body = toolJson(r);
    expect(body.type).toBe("rule");
    expect(body.rule_id).toBe("AB-039");
    expect(body.title).toBeDefined();
  });

  it("concept:<id> → knowledge-map node with slug article refs", async () => {
    const r = await handleHttpToolCall("get_knowledge_object", {
      id: "concept:agent-readiness",
    });
    const body = toolJson(r);
    expect(body.type).toBe("concept");
    expect(body.id).toBe("agent-readiness");
    // v1.3.0: articles are slugs
    expect(body.articles).toContain("what-is-agent-readiness");
  });

  it("unknown id → isError contract", async () => {
    const r = await handleHttpToolCall("get_knowledge_object", {
      id: "article:no-such-thing-xyz",
    });
    expect(r.isError).toBe(true);
  });
});
