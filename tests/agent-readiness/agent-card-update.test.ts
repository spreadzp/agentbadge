import { describe, it, expect } from "vitest";
import { buildAgentCard } from "../../src/server/routes/well-known";

describe("SLICE-49-15: Agent Card Update", () => {
  it("includes compliance_checking capability", () => {
    const card = buildAgentCard();
    expect(card.capabilities).toContain("compliance_checking");
  });

  it("includes agent_skills_discovery capability", () => {
    const card = buildAgentCard();
    expect(card.capabilities).toContain("agent_skills_discovery");
  });

  it("includes web_bot_auth capability", () => {
    const card = buildAgentCard();
    expect(card.capabilities).toContain("web_bot_auth");
  });

  it("includes compliance_checking in skills array", () => {
    const card = buildAgentCard();
    expect(card.skills).toContain("compliance_checking");
  });

  it("includes api_catalog endpoint", () => {
    const card = buildAgentCard();
    expect(card.endpoints).toHaveProperty("api_catalog");
    expect(card.endpoints.api_catalog).toContain("/.well-known/api-catalog");
  });

  it("includes oauth_protected_resource endpoint", () => {
    const card = buildAgentCard();
    expect(card.endpoints).toHaveProperty("oauth_protected_resource");
    expect(card.endpoints.oauth_protected_resource).toContain("/.well-known/oauth-protected-resource");
  });

  it("includes auth_md endpoint", () => {
    const card = buildAgentCard();
    expect(card.endpoints).toHaveProperty("auth_md");
    expect(card.endpoints.auth_md).toContain("/auth.md");
  });

  it("includes agent_skills endpoint", () => {
    const card = buildAgentCard();
    expect(card.endpoints).toHaveProperty("agent_skills");
    expect(card.endpoints.agent_skills).toContain("/.well-known/agent-skills/index.json");
  });

  it("includes web_bot_auth endpoint", () => {
    const card = buildAgentCard();
    expect(card.endpoints).toHaveProperty("web_bot_auth");
    expect(card.endpoints.web_bot_auth).toContain("/.well-known/http-message-signatures-directory");
  });

  it("includes http_message_signatures endpoint", () => {
    const card = buildAgentCard();
    expect(card.endpoints).toHaveProperty("http_message_signatures");
  });
});
