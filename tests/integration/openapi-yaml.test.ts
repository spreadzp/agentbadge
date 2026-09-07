import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { stringify as yamlStringify } from "yaml";

// SLICE-121-3: Test the YAML endpoint pattern in isolation
function createYamlApp() {
  const app = new Hono();

  // Simulate a JSON OpenAPI spec endpoint
  app.get("/openapi.json", (c) => {
    return c.json({
      openapi: "3.0.0",
      info: { title: "AgentBadge API", version: "1.0.0" },
      paths: {
        "/health": {
          get: {
            summary: "Health check",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
  });

  // YAML endpoint that converts JSON spec to YAML
  app.get("/openapi.yaml", async (_c) => {
    const specRes = await app.request("/openapi.json");
    const json = await specRes.json();
    const yamlStr = yamlStringify(json);
    return new Response(yamlStr, {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  });

  return app;
}

describe("SLICE-121-3: OpenAPI YAML endpoint", () => {
  const app = createYamlApp();

  it("/openapi.yaml returns 200", async () => {
    const res = await app.request("/openapi.yaml");
    expect(res.status).toBe(200);
  });

  it("returns application/yaml content type", async () => {
    const res = await app.request("/openapi.yaml");
    expect(res.headers.get("Content-Type")).toContain("application/yaml");
  });

  it("returns valid YAML with openapi field", async () => {
    const res = await app.request("/openapi.yaml");
    const text = await res.text();
    expect(text).toContain("openapi:");
    expect(text).toContain("3.0.0");
  });

  it("returns valid YAML with info section", async () => {
    const res = await app.request("/openapi.yaml");
    const text = await res.text();
    expect(text).toContain("title:");
    expect(text).toContain("AgentBadge API");
  });

  it("returns valid YAML with paths section", async () => {
    const res = await app.request("/openapi.yaml");
    const text = await res.text();
    expect(text).toContain("paths:");
    expect(text).toContain("/health");
  });

  it("YAML output is parseable back to same structure", async () => {
    const { parse: yamlParse } = await import("yaml");
    const res = await app.request("/openapi.yaml");
    const text = await res.text();
    const parsed = yamlParse(text);
    expect(parsed.openapi).toBe("3.0.0");
    expect(parsed.info.title).toBe("AgentBadge API");
    expect(parsed.paths["/health"]).toBeDefined();
  });
});
