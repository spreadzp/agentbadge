import { describe, it, expect, vi } from "vitest";
import { fetchEndpointProbe } from "../../../../src/agent-readiness/scanner/fetchers/endpoint-probe-fetcher";
import type { ResponseSnapshot } from "../../../../src/agent-readiness/scanner/snapshot";

function makeSnapshot(body: string): ResponseSnapshot {
  return {
    url: "https://api.example.com/openapi.json",
    status: 200,
    body,
    bodyHash: "",
    bodySize: 0,
    contentType: "application/json",
    resolvedIp: null,
    fetchedAt: new Date().toISOString(),
    fetchTimeMs: 0,
    redirectChain: [],
    headers: {},
  };
}

function mockFetch(responses: Record<string, { status: number; contentType?: string; body?: string }>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, resp] of Object.entries(responses)) {
      if (url.endsWith(path)) {
        return new Response(resp.body ?? "{}", {
          status: resp.status,
          headers: resp.contentType ? { "content-type": resp.contentType } : {},
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("endpoint-probe-fetcher", () => {
  it("returns no_openapi when openapi snapshot is null", async () => {
    const result = await fetchEndpointProbe("https://api.example.com", null);
    expect(result.status).toBe("no_openapi");
    expect(result.endpoints).toHaveLength(0);
  });

  it("returns no_openapi when openapi snapshot body is null", async () => {
    const result = await fetchEndpointProbe("https://api.example.com", {
      url: "x", status: 200, body: null, bodyHash: "", bodySize: 0, contentType: null, resolvedIp: null, fetchedAt: "", fetchTimeMs: 0, redirectChain: [], headers: {},
    });
    expect(result.status).toBe("no_openapi");
    expect(result.endpoints).toHaveLength(0);
  });

  it("returns no_openapi when body is invalid JSON", async () => {
    const result = await fetchEndpointProbe("https://api.example.com", makeSnapshot("not json"));
    expect(result.status).toBe("no_openapi");
    expect(result.endpoints).toHaveLength(0);
  });

  it("finds safe GET endpoints without security", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } },
        "/users": { get: { security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } } },
        "/status": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const fetchFn = mockFetch({
      "/health": { status: 200, contentType: "application/json" },
      "/status": { status: 200, contentType: "application/json" },
    });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, { maxEndpoints: 3 }, fetchFn);
    expect(result.status).toBe("success");
    expect(result.endpoints).toHaveLength(2);
    expect(result.endpoints.map((e) => e.path).sort()).toEqual(["/health", "/status"]);
  });

  it("skips endpoints with path parameters", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } },
        "/users/{id}": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const fetchFn = mockFetch({ "/health": { status: 200 } });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, { maxEndpoints: 3 }, fetchFn);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].path).toBe("/health");
  });

  it("skips non-GET methods", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } },
        "/submit": { post: { responses: { "201": { description: "Created" } } } },
      },
    }));
    const fetchFn = mockFetch({ "/health": { status: 200 } });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, { maxEndpoints: 3 }, fetchFn);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].path).toBe("/health");
  });

  it("respects maxEndpoints limit", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/a": { get: { responses: { "200": { description: "OK" } } } },
        "/b": { get: { responses: { "200": { description: "OK" } } } },
        "/c": { get: { responses: { "200": { description: "OK" } } } },
        "/d": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const fetchFn = mockFetch({
      "/a": { status: 200 }, "/b": { status: 200 }, "/c": { status: 200 }, "/d": { status: 200 },
    });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, { maxEndpoints: 2 }, fetchFn);
    expect(result.endpoints).toHaveLength(2);
  });

  it("records response status and content-type", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const fetchFn = mockFetch({ "/health": { status: 200, contentType: "application/json" } });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, {}, fetchFn);
    expect(result.endpoints[0].responseStatus).toBe(200);
    expect(result.endpoints[0].contentType).toContain("application/json");
  });

  it("checks if response status matches OpenAPI responses", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const fetchFn = mockFetch({ "/health": { status: 200 } });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, {}, fetchFn);
    expect(result.endpoints[0].matchesOpenApi).toBe(true);
  });

  it("marks mismatch when response status not in OpenAPI responses", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const fetchFn = mockFetch({ "/health": { status: 500 } });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, {}, fetchFn);
    expect(result.endpoints[0].matchesOpenApi).toBe(false);
    expect(result.endpoints[0].responseStatus).toBe(500);
  });

  it("returns no_safe_endpoints when no safe GET endpoints found", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/users": { get: { security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } } },
        "/items/{id}": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const result = await fetchEndpointProbe("https://api.example.com", openapi, {});
    expect(result.status).toBe("no_safe_endpoints");
    expect(result.endpoints).toHaveLength(0);
  });

  it("handles fetch errors gracefully", async () => {
    const openapi = makeSnapshot(JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/health": { get: { responses: { "200": { description: "OK" } } } },
      },
    }));
    const fetchFn = vi.fn(async () => { throw new Error("network failure"); }) as unknown as typeof fetch;
    const result = await fetchEndpointProbe("https://api.example.com", openapi, {}, fetchFn);
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].responseStatus).toBe(0);
    expect(result.endpoints[0].matchesOpenApi).toBe(false);
    expect(result.endpoints[0].error).toContain("network failure");
  });

  it("defaults maxEndpoints to 3 when not specified", async () => {
    const paths: Record<string, any> = {};
    for (const p of ["/a", "/b", "/c", "/d", "/e"]) {
      paths[p] = { get: { responses: { "200": { description: "OK" } } } };
    }
    const openapi = makeSnapshot(JSON.stringify({ openapi: "3.0.0", paths }));
    const fetchFn = mockFetch({
      "/a": { status: 200 }, "/b": { status: 200 }, "/c": { status: 200 }, "/d": { status: 200 }, "/e": { status: 200 },
    });
    const result = await fetchEndpointProbe("https://api.example.com", openapi, undefined, fetchFn);
    expect(result.endpoints).toHaveLength(3);
  });
});
