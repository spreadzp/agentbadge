import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// SLICE-121-6: Test the skill.json JSON-LD endpoint
function createSkillJsonApp() {
  const app = new Hono();
  const baseUrl = "https://agentbadge.xyz";

  app.get("/skill.json", () => {
    const skill = {
      "@context": {
        "@vocab": "https://schema.org/",
        ab: "https://agentbadge.xyz/vocab#",
      },
      "@type": "SoftwareApplication",
      "@id": `${baseUrl}/skill.json`,
      name: "agentbadge",
      version: "1.0.0",
      format: "agentbadge-agent-v1",
      description: "AgentBadge gives AI agents on-chain identity via NFT passports on Hedera.",
      url: baseUrl,
      applicationCategory: "AIAgentPlatform",
      "ab:capabilities": [
        "agent_identity",
        "passport_issuance",
        "agent_directory",
        "marketplace",
        "a2a_messaging",
        "micropayments",
      ],
      "ab:endpoints": {
        api: `${baseUrl}/api/specs`,
        openapi_yaml: `${baseUrl}/openapi.yaml`,
        mcp: `${baseUrl}/mcp`,
        llms_txt: `${baseUrl}/llms.txt`,
        skill_md: `${baseUrl}/skill.md`,
        heartbeat_md: `${baseUrl}/heartbeat.md`,
        agent_card: `${baseUrl}/.well-known/agent-card.json`,
      },
      "ab:auth": {
        type: "none",
        description: "No API key required. Paid endpoints use x402.",
        oauth: `${baseUrl}/.well-known/oauth-authorization-server`,
      },
      "ab:payment": {
        protocol: "x402",
        spec: "https://x402.org",
        facilitator: `${baseUrl}/.well-known/x402.json`,
      },
      "ab:mcp_tools": [
        "request_passport",
        "verify_passport",
        "register_agent",
        "find_agents",
      ],
      "ab:linked_files": [
        { file: "skill.md", url: `${baseUrl}/skill.md`, purpose: "Agent onboarding" },
        { file: "llms.txt", url: `${baseUrl}/llms.txt`, purpose: "LLM discovery" },
      ],
    };
    return new Response(JSON.stringify(skill, null, 2), {
      headers: {
        "Content-Type": "application/ld+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  });

  return app;
}

describe("SLICE-121-6: skill.json JSON-LD endpoint", () => {
  const app = createSkillJsonApp();
  let parsed: Record<string, unknown>;

  async function getParsed() {
    if (!parsed) {
      const res = await app.request("/skill.json");
      const text = await res.text();
      parsed = JSON.parse(text);
    }
    return parsed;
  }

  it("returns 200", async () => {
    const res = await app.request("/skill.json");
    expect(res.status).toBe(200);
  });

  it("returns application/ld+json content type", async () => {
    const res = await app.request("/skill.json");
    expect(res.headers.get("Content-Type")).toContain("application/ld+json");
  });

  it("returns valid JSON (parseable)", async () => {
    const res = await app.request("/skill.json");
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("has @context field", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("@context");
  });

  it("has @type field", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("@type");
  });

  it("@type is SoftwareApplication", async () => {
    const data = await getParsed();
    expect(data["@type"]).toBe("SoftwareApplication");
  });

  it("has name field set to agentbadge", async () => {
    const data = await getParsed();
    expect(data.name).toBe("agentbadge");
  });

  it("has version field", async () => {
    const data = await getParsed();
    expect(data.version).toBe("1.0.0");
  });

  it("has description field", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("description");
  });

  it("has url field", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("url");
  });

  it("has ab:capabilities array", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("ab:capabilities");
    expect(Array.isArray(data["ab:capabilities"])).toBe(true);
  });

  it("capabilities include agent_identity", async () => {
    const data = await getParsed();
    expect(data["ab:capabilities"]).toContain("agent_identity");
  });

  it("capabilities include marketplace", async () => {
    const data = await getParsed();
    expect(data["ab:capabilities"]).toContain("marketplace");
  });

  it("has ab:endpoints object", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("ab:endpoints");
    expect(typeof data["ab:endpoints"]).toBe("object");
  });

  it("endpoints include api", async () => {
    const data = await getParsed();
    expect(data["ab:endpoints"]).toHaveProperty("api");
  });

  it("endpoints include mcp", async () => {
    const data = await getParsed();
    expect(data["ab:endpoints"]).toHaveProperty("mcp");
  });

  it("endpoints include llms_txt", async () => {
    const data = await getParsed();
    expect(data["ab:endpoints"]).toHaveProperty("llms_txt");
  });

  it("endpoints include skill_md", async () => {
    const data = await getParsed();
    expect(data["ab:endpoints"]).toHaveProperty("skill_md");
  });

  it("endpoints include heartbeat_md", async () => {
    const data = await getParsed();
    expect(data["ab:endpoints"]).toHaveProperty("heartbeat_md");
  });

  it("has ab:auth object", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("ab:auth");
  });

  it("auth type is none", async () => {
    const data = await getParsed();
    expect(data["ab:auth"].type).toBe("none");
  });

  it("has ab:payment object", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("ab:payment");
  });

  it("payment protocol is x402", async () => {
    const data = await getParsed();
    expect(data["ab:payment"].protocol).toBe("x402");
  });

  it("has ab:mcp_tools array", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("ab:mcp_tools");
    expect(Array.isArray(data["ab:mcp_tools"])).toBe(true);
  });

  it("mcp_tools include request_passport", async () => {
    const data = await getParsed();
    expect(data["ab:mcp_tools"]).toContain("request_passport");
  });

  it("has ab:linked_files array", async () => {
    const data = await getParsed();
    expect(data).toHaveProperty("ab:linked_files");
    expect(Array.isArray(data["ab:linked_files"])).toBe(true);
  });

  it("linked_files include skill.md entry", async () => {
    const data = await getParsed();
    const files = data["ab:linked_files"] as Array<{ file: string }>;
    expect(files.some((f) => f.file === "skill.md")).toBe(true);
  });
});
