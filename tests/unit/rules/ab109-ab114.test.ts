import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB109 } from "../../../src/agent-readiness/rules/AB109";
import { AB110 } from "../../../src/agent-readiness/rules/AB110";
import { AB111 } from "../../../src/agent-readiness/rules/AB111";
import { AB112 } from "../../../src/agent-readiness/rules/AB112";
import { AB113 } from "../../../src/agent-readiness/rules/AB113";
import { AB114 } from "../../../src/agent-readiness/rules/AB114";
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

describe("SLICE-75-3: Agent Discovery Rules AB-109 through AB-114", () => {
  // ─── AB-109: Agent Card version 1.0.0+ ────────────────────────────────────────
  describe("AB-109: Agent Card version 1.0.0+", () => {
    it("has correct metadata", () => {
      expect(AB109.rule_id).toBe("AB-109");
      expect(AB109.name).toBe("Agent Card version 1.0.0+");
      expect(AB109.category).toBe("machine_readable");
      expect(AB109.severity).toBe("medium");
      expect(AB109.counted_in_score).toBe(true);
      expect(AB109.check.type).toBe("schema_validation");
      expect(AB109.check.sources).toContain("agent_card");
      expect(AB109.check.match_keys).toContain("version");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB109);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-109");
      expect(found).toBeDefined();
      expect(found).toBe(AB109);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-109"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-109");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Agent Card version 1.0.0+");
    });

    it("checker returns evidence when version >= 1.0.0", () => {
      const state = makeState({
        agent_card: makeSnap(JSON.stringify({ name: "My API", version: "1.0.0" })),
      });
      const evidence = RULE_CHECKERS["AB-109"](state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns evidence when version < 1.0.0", () => {
      const state = makeState({
        agent_card: makeSnap(JSON.stringify({ name: "My API", version: "0.9.0" })),
      });
      const evidence = RULE_CHECKERS["AB-109"](state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns evidence when version missing", () => {
      const state = makeState({
        agent_card: makeSnap(JSON.stringify({ name: "My API" })),
      });
      const evidence = RULE_CHECKERS["AB-109"](state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns evidence on invalid JSON", () => {
      const state = makeState({
        agent_card: makeSnap("not json"),
      });
      const evidence = RULE_CHECKERS["AB-109"](state);
      expect(evidence).toHaveLength(1);
    });

    it("checker returns empty when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-109"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-110: Blog articles in AI sitemap ───────────────────────────────────────
  describe("AB-110: Blog articles in AI sitemap", () => {
    it("has correct metadata", () => {
      expect(AB110.rule_id).toBe("AB-110");
      expect(AB110.name).toBe("Blog articles in AI sitemap");
      expect(AB110.category).toBe("discovery");
      expect(AB110.severity).toBe("medium");
      expect(AB110.counted_in_score).toBe(true);
      expect(AB110.check.type).toBe("content_parse");
      expect(AB110.check.sources).toContain("ai_sitemap");
      expect(AB110.check.match_keys).toContain("blogUrls");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB110);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-110");
      expect(found).toBeDefined();
      expect(found).toBe(AB110);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-110"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-110");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Blog articles in AI sitemap");
    });

    it("detects blog URLs in AI sitemap", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset><url><loc>https://example.com/</loc></url>
<url><loc>https://example.com/blog/article-1</loc></url>
<url><loc>https://example.com/blog/article-2</loc></url>
</urlset>`;
      const state = makeState({
        ai_sitemap: makeSnap(xml, "application/xml"),
      });
      const evidence = RULE_CHECKERS["AB-110"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns evidence when no blog URLs present", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset><url><loc>https://example.com/</loc></url>
<url><loc>https://example.com/about</loc></url>
</urlset>`;
      const state = makeState({
        ai_sitemap: makeSnap(xml, "application/xml"),
      });
      const evidence = RULE_CHECKERS["AB-110"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-110"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-111: Crawl-delay directive in robots.txt ───────────────────────────────
  describe("AB-111: Crawl-delay directive in robots.txt", () => {
    it("has correct metadata", () => {
      expect(AB111.rule_id).toBe("AB-111");
      expect(AB111.name).toBe("Crawl-delay directive in robots.txt");
      expect(AB111.category).toBe("discovery");
      expect(AB111.severity).toBe("low");
      expect(AB111.counted_in_score).toBe(true);
      expect(AB111.check.type).toBe("content_parse");
      expect(AB111.check.sources).toContain("robots");
      expect(AB111.check.match_keys).toContain("crawlDelay");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB111);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-111");
      expect(found).toBeDefined();
      expect(found).toBe(AB111);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-111"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-111");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("Crawl-delay directive in robots.txt");
    });

    it("detects Crawl-delay directive", () => {
      const state = makeState({
        robots: makeSnap("User-agent: *\nCrawl-delay: 1\nDisallow: /private", "text/plain"),
      });
      const evidence = RULE_CHECKERS["AB-111"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns evidence when no Crawl-delay directive", () => {
      const state = makeState({
        robots: makeSnap("User-agent: *\nDisallow: /private", "text/plain"),
      });
      const evidence = RULE_CHECKERS["AB-111"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-111"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-112: OAuth Authorization Server metadata ───────────────────────────────
  describe("AB-112: OAuth Authorization Server metadata (RFC 9728)", () => {
    it("has correct metadata", () => {
      expect(AB112.rule_id).toBe("AB-112");
      expect(AB112.name).toBe("OAuth Authorization Server metadata (RFC 9728)");
      expect(AB112.category).toBe("identity");
      expect(AB112.severity).toBe("medium");
      expect(AB112.counted_in_score).toBe(true);
      expect(AB112.check.type).toBe("http_fetch");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB112);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-112");
      expect(found).toBeDefined();
      expect(found).toBe(AB112);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-112"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-112");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("OAuth Authorization Server metadata (RFC 9728)");
    });

    it("returns evidence when snapshot exists", () => {
      const state = makeState({
        oauth_authorization_server: makeSnap(JSON.stringify({ issuer: "https://example.com" })),
      });
      const evidence = RULE_CHECKERS["AB-112"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-112"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-113: LLM policy file ───────────────────────────────────────────────────
  describe("AB-113: LLM policy file", () => {
    it("has correct metadata", () => {
      expect(AB113.rule_id).toBe("AB-113");
      expect(AB113.name).toBe("LLM policy file");
      expect(AB113.category).toBe("discovery");
      expect(AB113.severity).toBe("low");
      expect(AB113.counted_in_score).toBe(true);
      expect(AB113.check.type).toBe("http_fetch");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB113);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-113");
      expect(found).toBeDefined();
      expect(found).toBe(AB113);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-113"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-113");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("LLM policy file");
    });

    it("returns evidence when snapshot exists", () => {
      const state = makeState({
        llm_policy: makeSnap(JSON.stringify({ version: "1.0", training: "allowed" })),
      });
      const evidence = RULE_CHECKERS["AB-113"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when snapshot missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-113"](state);
      expect(evidence).toHaveLength(0);
    });
  });

  // ─── AB-114: AI sitemap content type coverage ──────────────────────────────────
  describe("AB-114: AI sitemap content type coverage", () => {
    it("has correct metadata", () => {
      expect(AB114.rule_id).toBe("AB-114");
      expect(AB114.name).toBe("AI sitemap content type coverage");
      expect(AB114.category).toBe("discovery");
      expect(AB114.severity).toBe("medium");
      expect(AB114.counted_in_score).toBe(true);
      expect(AB114.check.type).toBe("cross_evidence");
      expect(AB114.check.sources).toContain("ai_sitemap");
      expect(AB114.check.sources).toContain("sitemap");
    });

    it("validates against schema", () => {
      const result = agentReadinessRuleSchema.safeParse(AB114);
      expect(result.success).toBe(true);
    });

    it("is registered in ruleset", () => {
      const found = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-114");
      expect(found).toBeDefined();
      expect(found).toBe(AB114);
    });

    it("has a checker function", () => {
      expect(RULE_CHECKERS["AB-114"]).toBeDefined();
    });

    it("has a rule description", () => {
      const desc = RULE_DESCRIPTIONS.find((d) => d.rule_id === "AB-114");
      expect(desc).toBeDefined();
      expect(desc!.title).toBe("AI sitemap content type coverage");
    });

    it("returns cross evidence when coverage >= 50%", () => {
      const aiXml = `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`;
      const sitemapXml = `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url><url><loc>https://example.com/c</loc></url></urlset>`;
      const state = makeState({
        ai_sitemap: makeSnap(aiXml, "application/xml"),
        sitemap: makeSnap(sitemapXml, "application/xml"),
      });
      const evidence = RULE_CHECKERS["AB-114"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns cross evidence when coverage < 50%", () => {
      const aiXml = `<urlset><url><loc>https://example.com/a</loc></url></urlset>`;
      const sitemapXml = `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url><url><loc>https://example.com/c</loc></url><url><loc>https://example.com/d</loc></url></urlset>`;
      const state = makeState({
        ai_sitemap: makeSnap(aiXml, "application/xml"),
        sitemap: makeSnap(sitemapXml, "application/xml"),
      });
      const evidence = RULE_CHECKERS["AB-114"](state);
      expect(evidence).toHaveLength(1);
    });

    it("returns empty evidence when both snapshots missing", () => {
      const state = makeState({});
      const evidence = RULE_CHECKERS["AB-114"](state);
      expect(evidence).toHaveLength(0);
    });
  });
});
