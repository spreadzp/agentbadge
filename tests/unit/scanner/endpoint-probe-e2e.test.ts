import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/agent-readiness/scanner/ssrf/dns-pin", () => ({
  resolveAndPin: async (hostname: string) => ({ ip: "93.184.216.34", hostname }),
}));

import { scanDomain } from "../../../src/agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";

const BASE_URL = "http://localhost:8080";

const OPENAPI_SPEC = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/health": {
      get: {
        responses: {
          "200": { description: "OK" },
        },
      },
    },
    "/status": {
      get: {
        responses: {
          "200": { description: "Status" },
        },
      },
    },
    "/secure": {
      get: {
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Secure" } },
      },
    },
    "/users/{id}": {
      get: {
        responses: { "200": { description: "User" } },
      },
    },
  },
});

function mockFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();

    // OpenAPI spec
    if (url.includes("/openapi.json")) {
      return new Response(OPENAPI_SPEC, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // Safe GET endpoints (no security, no path params)
    if (url.endsWith("/health") || url.endsWith("/status")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // Default: 404
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("endpoint probe E2E", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("full scan with --probe produces endpoint probe snapshot and AB-122/123/124 evidence", async () => {
    const state = await scanDomain(BASE_URL, {
      resources: ["openapi", "endpoint_probe"],
      probe: true,
      probeEndpoints: 3,
    });

    // Verify endpoint_probe snapshot exists
    expect(state.snapshots.endpoint_probe).toBeDefined();
    expect(state.snapshots.endpoint_probe).not.toBeNull();

    // Run rules
    const result = RuleEngine.run(state);

    // Verify AB-122, AB-123, AB-124 are present
    const ab122 = result.assertions.find((a) => a.rule_id === "AB-122");
    const ab123 = result.assertions.find((a) => a.rule_id === "AB-123");
    const ab124 = result.assertions.find((a) => a.rule_id === "AB-124");

    expect(ab122).toBeDefined();
    expect(ab123).toBeDefined();
    expect(ab124).toBeDefined();
  }, 15000);

  it("scan without --probe does not produce endpoint probe snapshot", async () => {
    const state = await scanDomain(BASE_URL, {
      resources: ["openapi"],
    });

    expect(state.snapshots.endpoint_probe).toBeUndefined();
  }, 15000);
});
