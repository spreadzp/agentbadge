import { describe, it, expect } from "vitest";
import { OpenApiParser } from "../../../src/agent-readiness/rule-engine/openapi-parser";

const spec30 = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/api": { get: {}, post: {} },
    "/api/agents": { get: {} },
    "/api/health": { get: {} },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", name: "X-API-Key", in: "header" },
      BearerAuth: { type: "http", scheme: "bearer" },
    },
  },
  servers: [
    { url: "https://api.example.com" },
    { url: "https://staging.example.com" },
  ],
});

const spec31 = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Test API 3.1", version: "2.0.0" },
  paths: {
    "/v2/data": { get: {}, put: {}, delete: {} },
    "/v2/auth": { post: {} },
  },
  components: {
    securitySchemes: {
      OAuth2: { type: "oauth2", flows: {} },
      OpenId: { type: "openIdConnect", openIdConnectUrl: "https://example.com/.well-known/openid-configuration" },
    },
  },
  servers: [{ url: "https://v2.example.com" }],
});

const specMinimal = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Minimal", version: "0.1.0" },
  paths: {},
});

describe("OpenApiParser", () => {
  it("parses valid OpenAPI 3.0 spec", () => {
    const facts = OpenApiParser.parse(spec30);

    expect(facts.valid).toBe(true);
    expect(facts.version).toBe("3.0.3");
    expect(facts.paths).toEqual(["/api", "/api/agents", "/api/health"]);
    expect(facts.methods).toContain("GET");
    expect(facts.methods).toContain("POST");
    expect(facts.methods).toHaveLength(2);
  });

  it("parses valid OpenAPI 3.1 spec", () => {
    const facts = OpenApiParser.parse(spec31);

    expect(facts.valid).toBe(true);
    expect(facts.version).toBe("3.1.0");
    expect(facts.paths).toEqual(["/v2/data", "/v2/auth"]);
    expect(facts.methods).toContain("GET");
    expect(facts.methods).toContain("PUT");
    expect(facts.methods).toContain("DELETE");
    expect(facts.methods).toContain("POST");
  });

  it("parses minimal OpenAPI spec with empty paths", () => {
    const facts = OpenApiParser.parse(specMinimal);

    expect(facts.valid).toBe(true);
    expect(facts.version).toBe("3.0.0");
    expect(facts.paths).toEqual([]);
    expect(facts.methods).toEqual([]);
  });

  it("extracts security schemes from 3.0 spec", () => {
    const facts = OpenApiParser.parse(spec30);

    expect(facts.securitySchemes).toHaveLength(2);
    expect(facts.securitySchemes[0].type).toBe("apiKey");
    expect(facts.securitySchemes[0].name).toBe("ApiKeyAuth");
    expect(facts.securitySchemes[1].type).toBe("http");
    expect(facts.securitySchemes[1].scheme).toBe("bearer");
  });

  it("extracts security schemes from 3.1 spec", () => {
    const facts = OpenApiParser.parse(spec31);

    expect(facts.securitySchemes).toHaveLength(2);
    expect(facts.securitySchemes[0].type).toBe("oauth2");
    expect(facts.securitySchemes[1].type).toBe("openIdConnect");
  });

  it("extracts servers", () => {
    const facts = OpenApiParser.parse(spec30);

    expect(facts.servers).toEqual([
      "https://api.example.com",
      "https://staging.example.com",
    ]);
  });

  it("returns empty facts for invalid JSON", () => {
    const facts = OpenApiParser.parse("not valid json {{{");

    expect(facts.valid).toBe(false);
    expect(facts.paths).toEqual([]);
    expect(facts.methods).toEqual([]);
  });

  it("returns empty facts for empty string", () => {
    const facts = OpenApiParser.parse("");

    expect(facts.valid).toBe(false);
    expect(facts.paths).toEqual([]);
  });

  it("returns empty facts for non-OpenAPI JSON", () => {
    const facts = OpenApiParser.parse(JSON.stringify({ foo: "bar" }));

    expect(facts.valid).toBe(false);
  });

  it("returns empty facts for OpenAPI 2.0 (swagger)", () => {
    const facts = OpenApiParser.parse(JSON.stringify({
      swagger: "2.0",
      paths: { "/api": { get: {} } },
    }));

    expect(facts.valid).toBe(false);
  });

  it("toEvidence converts facts to OpenApiEvidence", () => {
    const facts = OpenApiParser.parse(spec30);
    const evidence = OpenApiParser.toEvidence(facts, "https://example.com/openapi.json");

    expect(evidence.type).toBe("openapi");
    expect(evidence.url).toBe("https://example.com/openapi.json");
    expect(evidence.paths).toEqual(facts.paths);
    expect(evidence.methods).toEqual(facts.methods);
  });

  it("parseToEvidence combines parse + toEvidence", () => {
    const evidence = OpenApiParser.parseToEvidence(spec30, "https://example.com/openapi.json");

    expect(evidence.type).toBe("openapi");
    expect(evidence.paths).toHaveLength(3);
  });

  it("handles paths with non-method keys (parameters, summary)", () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/api": {
          get: {},
          parameters: [],
          summary: "Test path",
        },
      },
    });

    const facts = OpenApiParser.parse(spec);

    expect(facts.methods).toEqual(["GET"]);
    expect(facts.paths).toEqual(["/api"]);
  });
});
