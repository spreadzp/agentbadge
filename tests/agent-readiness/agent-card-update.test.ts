import { describe, it, expect } from "vitest";
import { buildAgentCard } from "../../src/server/routes/well-known";
import type { DiscoverySources } from "../../src/server/lib/agent-discovery";

// SLICE-178-2: buildAgentCard now takes DiscoverySources and returns a JSON
// string; legacy fields live under the x-agentbadge vendor block.
const SRC: DiscoverySources = {
  baseUrl: "https://agentbadge.xyz",
  authSection: "",
  llmsCore: "",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
};

type Card = {
  skills: Array<{ id: string }>;
  "x-agentbadge": {
    capabilities: string[];
    endpoints: Record<string, string>;
  };
};

function card(): Card {
  return JSON.parse(buildAgentCard(SRC)) as Card;
}

describe("SLICE-49-15: Agent Card Update", () => {
  it("includes compliance_checking capability", () => {
    expect(card()["x-agentbadge"].capabilities).toContain("compliance_checking");
  });

  it("includes agent_skills_discovery capability", () => {
    expect(card()["x-agentbadge"].capabilities).toContain(
      "agent_skills_discovery",
    );
  });

  it("includes web_bot_auth capability", () => {
    expect(card()["x-agentbadge"].capabilities).toContain("web_bot_auth");
  });

  it("skills array includes a compliance-related skill", () => {
    expect(card().skills.some((s) => s.id.includes("scan"))).toBe(true);
  });

  it("includes api_catalog endpoint", () => {
    const endpoints = card()["x-agentbadge"].endpoints;
    expect(endpoints).toHaveProperty("api_catalog");
    expect(endpoints.api_catalog).toContain("/.well-known/api-catalog");
  });

  it("includes oauth_protected_resource endpoint", () => {
    const endpoints = card()["x-agentbadge"].endpoints;
    expect(endpoints).toHaveProperty("oauth_protected_resource");
    expect(endpoints.oauth_protected_resource).toContain(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("includes auth_md endpoint", () => {
    const endpoints = card()["x-agentbadge"].endpoints;
    expect(endpoints).toHaveProperty("auth_md");
    expect(endpoints.auth_md).toContain("/auth.md");
  });

  it("includes agent_skills endpoint", () => {
    const endpoints = card()["x-agentbadge"].endpoints;
    expect(endpoints).toHaveProperty("agent_skills");
    expect(endpoints.agent_skills).toContain(
      "/.well-known/agent-skills/index.json",
    );
  });

  it("includes web_bot_auth endpoint", () => {
    const endpoints = card()["x-agentbadge"].endpoints;
    expect(endpoints).toHaveProperty("web_bot_auth");
    expect(endpoints.web_bot_auth).toContain(
      "/.well-known/http-message-signatures-directory",
    );
  });

  it("includes http_message_signatures endpoint", () => {
    const endpoints = card()["x-agentbadge"].endpoints;
    expect(endpoints).toHaveProperty("http_message_signatures");
  });
});
