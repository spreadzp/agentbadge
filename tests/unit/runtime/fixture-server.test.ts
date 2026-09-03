import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";

describe("SLICE-98-2: Runtime fixture server", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0 });
    baseUrl = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("serves llms.txt", async () => {
    const res = await fetch(`${baseUrl}/llms.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("AgentBadge");
    expect(text).toContain("/openapi.json");
  });

  it("serves agents.txt", async () => {
    const res = await fetch(`${baseUrl}/agents.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("agent");
  });

  it("serves well-known agent entry", async () => {
    const res = await fetch(`${baseUrl}/.well-known/ai-plugin.json`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("schema_version");
    expect(json).toHaveProperty("api", "openapi");
  });

  it("serves OpenAPI spec with OAuth2 declared", async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe("3.0.0");
    // Auth scheme declared as OAuth2 (mismatch: actual is API-key)
    expect(spec.components?.securitySchemes?.oauth2).toBeDefined();
    expect(spec.components?.securitySchemes?.oauth2?.type).toBe("oauth2");
  });

  it("serves read endpoint that returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/v1/status`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("status");
  });

  it("returns 401 with API-key auth on protected endpoint (mismatch: declared OAuth2)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/protected`);
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate");
    expect(wwwAuth).toContain("ApiKey");
  });

  it("returns 429 without Retry-After on rate-limited endpoint (mismatch: declared with Retry-After)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/rate-limited`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("returns 404 on safe-invalid endpoint", async () => {
    const res = await fetch(`${baseUrl}/api/v1/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("serves rate-limit headers on normal responses", async () => {
    const res = await fetch(`${baseUrl}/api/v1/status`);
    expect(res.headers.get("x-ratelimit-limit")).toBe("100");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("99");
  });

  it("supports toggleable mismatch scenarios", async () => {
    const server2 = createRuntimeTargetServer({
      port: 0,
      scenarios: { authMismatch: false, rateLimitMismatch: false },
    });
    const url2 = await server2.start();
    try {
      // Without auth mismatch: protected endpoint accepts any auth
      const res = await fetch(`${url2}/api/v1/protected`, {
        headers: { "X-Api-Key": "test-key" },
      });
      expect(res.status).toBe(200);
    } finally {
      await server2.stop();
    }
  });
});
