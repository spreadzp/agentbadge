import { describe, it, expect } from "vitest";
import { DEFAULT_RESOURCES, scanDomain } from "../../../src/agent-readiness/scanner/orchestrator";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";

describe("Orchestrator integration for session-scoped auth", () => {
  it("DEFAULT_RESOURCES includes aauth", () => {
    expect(DEFAULT_RESOURCES).toContain("aauth");
  });

  it("DEFAULT_RESOURCES includes credential_security", () => {
    expect(DEFAULT_RESOURCES).toContain("credential_security");
  });

  it("aauth runs in parallel phase", () => {
    const parallelResources = DEFAULT_RESOURCES.filter((r) =>
      ["robots", "sitemap", "llms", "content_negotiation", "x402", "openapi_standard", "skill", "agents_txt", "webmcp", "llms_full", "rss_feed", "mcp_probe", "homepage_meta", "infrastructure", "a2a", "identity", "bot_auth", "favicon", "pricing", "link_headers", "api_catalog", "oauth_protected_resource", "auth_md", "agent_skills", "content_signals", "web_bot_auth", "dns_aid", "webmcp_runtime", "l402", "og_meta", "aeo_content", "semantic_html", "accessibility", "content_depth", "agent_card", "ai_sitemap", "oauth_authorization_server", "llm_policy", "aauth"].includes(r),
    );
    expect(parallelResources).toContain("aauth");
  });

  it("credential_security runs in sequential phase", () => {
    const sequentialResources = DEFAULT_RESOURCES.filter(
      (r) =>
        !["robots", "sitemap", "llms", "content_negotiation", "x402", "openapi_standard", "skill", "agents_txt", "webmcp", "llms_full", "rss_feed", "mcp_probe", "homepage_meta", "infrastructure", "a2a", "identity", "bot_auth", "favicon", "pricing", "link_headers", "api_catalog", "oauth_protected_resource", "auth_md", "agent_skills", "content_signals", "web_bot_auth", "dns_aid", "webmcp_runtime", "l402", "og_meta", "aeo_content", "semantic_html", "accessibility", "content_depth", "agent_card", "ai_sitemap", "oauth_authorization_server", "llm_policy", "aauth"].includes(r),
    );
    expect(sequentialResources).toContain("credential_security");
  });

  it("AGENT_READINESS_RULESET includes AB-128 through AB-145", () => {
    const ruleIds = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    for (let i = 128; i <= 145; i++) {
      expect(ruleIds).toContain(`AB-${String(i).padStart(3, "0")}`);
    }
  });

  it("RULE_DESCRIPTIONS includes AB-128 through AB-145", () => {
    const descIds = RULE_DESCRIPTIONS.map((d) => d.rule_id);
    for (let i = 128; i <= 145; i++) {
      expect(descIds).toContain(`AB-${String(i).padStart(3, "0")}`);
    }
  });

  it("scanDomain produces aauth snapshot", async () => {
    const state = await scanDomain("https://example.com", { noCache: true, resources: ["aauth"] });
    expect(state.snapshots.aauth).toBeDefined();
  }, 15000);

  it("scanDomain produces credential_security snapshot", async () => {
    const state = await scanDomain("https://example.com", { noCache: true, resources: ["credential_security"] });
    expect(state.snapshots.credential_security).toBeDefined();
  }, 15000);
});
