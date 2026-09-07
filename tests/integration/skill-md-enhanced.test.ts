import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// SLICE-121-4: Test the enhanced skill.md content
function createSkillApp() {
  const app = new Hono();
  const baseUrl = "https://agentbadge.xyz";

  app.get("/skill.md", () => {
    const body = `---
name: agentbadge
version: 1.0.0
format: agentbadge-agent-v1
description: AgentBadge gives AI agents on-chain identity via NFT passports on Hedera. Agents register, get DID, and transact on marketplace.
homepage: ${baseUrl}
api_base: ${baseUrl}
mcp_endpoint: ${baseUrl}/mcp
openapi: ${baseUrl}/api/specs
llms_txt: ${baseUrl}/llms.txt
---

## AgentBadge API Skill

AgentBadge provides agent identity, verification, and marketplace tools on Hedera.

### Linked Files

| File | URL | Purpose |
|------|-----|---------|
| skill.md (this file) | ${baseUrl}/skill.md | Agent onboarding & skill definition |
| llms.txt | ${baseUrl}/llms.txt | LLM-friendly API discovery |
| openapi.yaml | ${baseUrl}/openapi.yaml | Full API contract (YAML) |
| openapi.json | ${baseUrl}/openapi.json | Full API contract (JSON) |
| MCP server | ${baseUrl}/mcp | JSON-RPC over HTTP (MCP) |
| Agent Card | ${baseUrl}/.well-known/agent-card.json | Machine-readable agent identity |

### next_call Pattern

API responses include a \`next_call\` field in JSON payloads suggesting the next
action an agent should take.

### Error Handling

| Error Code | HTTP Status | Meaning | Recovery |
|------------|-------------|---------|----------|
| \`passport_not_found\` | 404 | Passport NFT does not exist | Request a passport first |
| \`payment_required\` | 402 | x402 payment needed | Send payment per x402 protocol |

### Token & Payment Lifecycle (x402)

1. Agent calls a paid endpoint (e.g., \`POST /passport/request\`)
2. Server returns HTTP 402 with payment requirements
3. Agent constructs an x402 payment header
4. Agent retries the request with \`X-PAYMENT\` header
`;
    return new Response(body, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  });

  return app;
}

describe("SLICE-121-4: Enhanced skill.md", () => {
  const app = createSkillApp();
  let body: string;

  async function getBody() {
    if (!body) {
      const res = await app.request("/skill.md");
      body = await res.text();
    }
    return body;
  }

  it("returns 200 with text/markdown content type", async () => {
    const res = await app.request("/skill.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
  });

  it("has YAML frontmatter with name: agentbadge", async () => {
    const text = await getBody();
    expect(text).toContain("---\nname: agentbadge");
  });

  it("has version field in frontmatter", async () => {
    const text = await getBody();
    expect(text).toContain("version: 1.0.0");
  });

  it("has format field in frontmatter", async () => {
    const text = await getBody();
    expect(text).toContain("format: agentbadge-agent-v1");
  });

  it("has api_base field in frontmatter", async () => {
    const text = await getBody();
    expect(text).toContain("api_base:");
  });

  it("has mcp_endpoint field in frontmatter", async () => {
    const text = await getBody();
    expect(text).toContain("mcp_endpoint:");
  });

  it("has openapi field in frontmatter", async () => {
    const text = await getBody();
    expect(text).toContain("openapi:");
  });

  it("has llms_txt field in frontmatter", async () => {
    const text = await getBody();
    expect(text).toContain("llms_txt:");
  });

  it("has Linked Files table", async () => {
    const text = await getBody();
    expect(text).toContain("### Linked Files");
    expect(text).toContain("| File | URL | Purpose |");
  });

  it("linked files table includes openapi.yaml", async () => {
    const text = await getBody();
    expect(text).toContain("openapi.yaml");
  });

  it("linked files table includes MCP server", async () => {
    const text = await getBody();
    expect(text).toContain("MCP server");
  });

  it("linked files table includes Agent Card", async () => {
    const text = await getBody();
    expect(text).toContain("Agent Card");
  });

  it("has next_call pattern section", async () => {
    const text = await getBody();
    expect(text).toContain("### next_call Pattern");
    expect(text).toContain("next_call");
  });

  it("has error handling section with error codes", async () => {
    const text = await getBody();
    expect(text).toContain("### Error Handling");
    expect(text).toContain("passport_not_found");
    expect(text).toContain("payment_required");
  });

  it("has token & payment lifecycle section", async () => {
    const text = await getBody();
    expect(text).toContain("### Token & Payment Lifecycle");
    expect(text).toContain("x402");
  });
});
