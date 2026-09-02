import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLinkHeaders } from "../../../src/agent-readiness/scanner/fetchers/link-headers-fetcher";
import { fetchApiCatalog } from "../../../src/agent-readiness/scanner/fetchers/api-catalog-fetcher";
import { fetchOauthProtectedResource } from "../../../src/agent-readiness/scanner/fetchers/oauth-protected-resource-fetcher";
import { fetchAuthMd } from "../../../src/agent-readiness/scanner/fetchers/auth-md-fetcher";
import { fetchAgentSkills } from "../../../src/agent-readiness/scanner/fetchers/agent-skills-fetcher";
import { fetchContentSignals } from "../../../src/agent-readiness/scanner/fetchers/content-signals-fetcher";
import { fetchWebBotAuth } from "../../../src/agent-readiness/scanner/fetchers/web-bot-auth-fetcher";
import { fetchDnsAid } from "../../../src/agent-readiness/scanner/fetchers/dns-aid-fetcher";
import { fetchWebmcpRuntime } from "../../../src/agent-readiness/scanner/fetchers/webmcp-runtime-fetcher";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";

// Mock safeFetch
vi.mock("../../../src/agent-readiness/scanner/ssrf/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../../../src/agent-readiness/scanner/ssrf/safe-fetch";

const mockedSafeFetch = vi.mocked(safeFetch);

beforeEach(() => {
  vi.resetAllMocks();
});

function mockResponse(body: string, status = 200, headers: Record<string, string> = {}): ReturnType<typeof vi.fn> {
  return mockedSafeFetch.mockResolvedValue({
    status,
    headers,
    body: new ArrayBuffer(0),
    bodyText: body,
    resolvedIp: "127.0.0.1",
    fetchTime: 10,
    redirectChain: [],
  }) as unknown as ReturnType<typeof vi.fn>;
}

// ── SLICE-49-10: Fetcher tests ──────────────────────────────────

describe("SLICE-49-10: CLI Fetchers", () => {
  describe("fetchLinkHeaders", () => {
    it("parses Link header into structured array", async () => {
      mockResponse("<html></html>", 200, {
        link: '</.well-known/api-catalog>; rel="api-catalog", </sitemap.xml>; rel="sitemap"',
      });
      const result = await fetchLinkHeaders("https://example.com");
      expect(result.status).toBe(200);
      expect(result.linkHeaders).toHaveLength(2);
      expect(result.linkHeaders[0]).toEqual({ href: "/.well-known/api-catalog", rel: "api-catalog" });
      expect(result.linkHeaders[1]).toEqual({ href: "/sitemap.xml", rel: "sitemap" });
    });

    it("returns empty array when no Link header", async () => {
      mockResponse("<html></html>", 200, {});
      const result = await fetchLinkHeaders("https://example.com");
      expect(result.linkHeaders).toEqual([]);
    });

    it("returns status 0 on network error", async () => {
      mockedSafeFetch.mockRejectedValue(new Error("network error"));
      const result = await fetchLinkHeaders("https://example.com");
      expect(result.status).toBe(0);
      expect(result.linkHeaders).toEqual([]);
    });
  });

  describe("fetchApiCatalog", () => {
    it("fetches /.well-known/api-catalog and returns body", async () => {
      mockResponse(JSON.stringify({ api: [] }), 200);
      const result = await fetchApiCatalog("https://example.com");
      expect(result.status).toBe(200);
      expect(result.body).toContain("api");
      expect(result.parseError).toBeNull();
    });

    it("returns parseError for invalid JSON", async () => {
      mockResponse("not json", 200);
      const result = await fetchApiCatalog("https://example.com");
      expect(result.parseError).toBe("invalid_json");
    });
  });

  describe("fetchOauthProtectedResource", () => {
    it("fetches /.well-known/oauth-protected-resource", async () => {
      mockResponse(JSON.stringify({ resource: "https://example.com" }), 200);
      const result = await fetchOauthProtectedResource("https://example.com");
      expect(result.status).toBe(200);
      expect(result.parseError).toBeNull();
    });
  });

  describe("fetchAuthMd", () => {
    it("fetches /auth.md", async () => {
      mockResponse("# Auth Instructions", 200);
      const result = await fetchAuthMd("https://example.com");
      expect(result.status).toBe(200);
      expect(result.body).toContain("Auth");
    });
  });

  describe("fetchAgentSkills", () => {
    it("fetches /.well-known/agent-skills/index.json", async () => {
      mockResponse(JSON.stringify({ skills: [] }), 200);
      const result = await fetchAgentSkills("https://example.com");
      expect(result.status).toBe(200);
      expect(result.parseError).toBeNull();
    });
  });

  describe("fetchContentSignals", () => {
    it("parses Content-Signal directive from robots.txt", async () => {
      mockResponse("User-agent: *\nAllow: /\n\nContent-Signal: ai-train=no, search=yes, ai-input=no\n", 200);
      const result = await fetchContentSignals("https://example.com");
      expect(result.contentSignals.ai_train).toBe("no");
      expect(result.contentSignals.search).toBe("yes");
      expect(result.contentSignals.ai_input).toBe("no");
    });

    it("returns null signals when no Content-Signal directive", async () => {
      mockResponse("User-agent: *\nAllow: /\n", 200);
      const result = await fetchContentSignals("https://example.com");
      expect(result.contentSignals.ai_train).toBeNull();
    });
  });

  describe("fetchWebBotAuth", () => {
    it("fetches /.well-known/http-message-signatures-directory", async () => {
      mockResponse(JSON.stringify({ keys: [] }), 200);
      const result = await fetchWebBotAuth("https://example.com");
      expect(result.status).toBe(200);
      expect(result.parseError).toBeNull();
    });
  });

  describe("fetchDnsAid", () => {
    it("queries DoH resolver for TXT records", async () => {
      const result = await fetchDnsAid("example.com");
      expect(result.domain).toBe("example.com");
      expect(result.found).toBeDefined();
      expect(result.fetchTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("fetchWebmcpRuntime", () => {
    it("detects document.modelContext in HTML", async () => {
      mockResponse('<html><script>await document.modelContext.registerTool({name:"test",inputSchema:{},execute:()=>{}})</script></html>', 200);
      const result = await fetchWebmcpRuntime("https://example.com");
      expect(result.hasModelContext).toBe(true);
      expect(result.hasRegisterTool).toBe(true);
      expect(result.toolCount).toBeGreaterThanOrEqual(1);
    });

    it("returns false when no WebMCP present", async () => {
      mockResponse("<html><body>No WebMCP</body></html>", 200);
      const result = await fetchWebmcpRuntime("https://example.com");
      expect(result.hasModelContext).toBe(false);
      expect(result.toolCount).toBe(0);
    });
  });
});

// ── SLICE-49-11: Rule registration tests ────────────────────────

describe("SLICE-49-11: CLI Rules AB-061..AB-069", () => {
  it("ruleset contains AB-061 through AB-069", () => {
    const ruleIds = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(ruleIds).toContain("AB-061");
    expect(ruleIds).toContain("AB-062");
    expect(ruleIds).toContain("AB-063");
    expect(ruleIds).toContain("AB-064");
    expect(ruleIds).toContain("AB-065");
    expect(ruleIds).toContain("AB-066");
    expect(ruleIds).toContain("AB-067");
    expect(ruleIds).toContain("AB-068");
    expect(ruleIds).toContain("AB-069");
  });

  it("AB-061 is Link headers rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-061");
    expect(rule?.name).toContain("Link headers");
    expect(rule?.category).toBe("discovery");
    expect(rule?.counted_in_score).toBe(true);
  });

  it("AB-062 is API Catalog rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-062");
    expect(rule?.name).toContain("API Catalog");
    expect(rule?.check.target).toBe("/.well-known/api-catalog");
  });

  it("AB-063 is OAuth Protected Resource rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-063");
    expect(rule?.name).toContain("OAuth Protected Resource");
    expect(rule?.check.target).toBe("/.well-known/oauth-protected-resource");
  });

  it("AB-064 is Auth.md rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-064");
    expect(rule?.name).toContain("Auth.md");
    expect(rule?.check.target).toBe("/auth.md");
  });

  it("AB-065 is Agent Skills index rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-065");
    expect(rule?.name).toContain("Agent Skills");
    expect(rule?.check.target).toBe("/.well-known/agent-skills/index.json");
  });

  it("AB-066 is Content Signals rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-066");
    expect(rule?.name).toContain("Content Signals");
    expect(rule?.check.type).toBe("content_parse");
  });

  it("AB-067 is Web Bot Auth rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-067");
    expect(rule?.name).toContain("Web Bot Auth");
    expect(rule?.check.target).toBe("/.well-known/http-message-signatures-directory");
  });

  it("AB-068 is DNS-AID rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-068");
    expect(rule?.name).toContain("DNS-AID");
    expect(rule?.fix.eligible).toBe(false);
  });

  it("AB-069 is WebMCP runtime rule", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-069");
    expect(rule?.name).toContain("WebMCP");
    expect(rule?.category).toBe("webmcp");
  });

  it("all 9 new rules are counted_in_score", () => {
    const newRules = AGENT_READINESS_RULESET.rules.filter((r) =>
      ["AB-061", "AB-062", "AB-063", "AB-064", "AB-065", "AB-066", "AB-067", "AB-068", "AB-069"].includes(r.rule_id),
    );
    expect(newRules.every((r) => r.counted_in_score)).toBe(true);
  });
});
