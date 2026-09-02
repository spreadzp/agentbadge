import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/agent-readiness/scanner/ssrf/dns-pin", () => ({
  resolveAndPin: async (hostname: string) => ({ ip: "93.184.216.34", hostname }),
}));

import { scanDomain } from "../../../src/agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { computeFunnel } from "../../../src/agent-readiness/scoring/funnel-computer";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";

const BASE_URL = "http://localhost:8080";

const HOMEPAGE_HTML = `<!DOCTYPE html>
<html>
<head>
<title>Test API</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Test Business",
  "openingHours": "Mo-Fr 09:00-17:00",
  "areaServed": "US",
  "telephone": "+1-555-0100"
}
</script>
</head>
<body><h1>Test API</h1></body>
</html>`;

const OPENAPI_SPEC = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/health": {
      get: {
        responses: { "200": { description: "OK" } },
      },
    },
    "/status": {
      get: {
        responses: { "200": { description: "Status" } },
      },
    },
  },
});

const OAUTH_METADATA = JSON.stringify({
  issuer: BASE_URL,
  token_endpoint: `${BASE_URL}/oauth/token`,
  grant_types_supported: ["client_credentials"],
});

const TOKEN_RESPONSE = JSON.stringify({
  access_token: "test-token-123",
  token_type: "Bearer",
  expires_in: 3600,
});

function mockFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    // Homepage
    if (url === BASE_URL + "/" || url === BASE_URL) {
      return new Response(HOMEPAGE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }

    // OpenAPI spec
    if (url.includes("/openapi.json")) {
      return new Response(OPENAPI_SPEC, { status: 200, headers: { "content-type": "application/json" } });
    }

    // OAuth authorization server metadata
    if (url.includes(".well-known/oauth-authorization-server")) {
      return new Response(OAUTH_METADATA, { status: 200, headers: { "content-type": "application/json" } });
    }

    // Token endpoint
    if (url.includes("oauth/token") && init?.method === "POST") {
      return new Response(TOKEN_RESPONSE, { status: 200, headers: { "content-type": "application/json" } });
    }

    // Protected endpoint (GET with Authorization header)
    if (init?.headers && (init.headers as Record<string, string>)["Authorization"]) {
      return new Response(JSON.stringify({ data: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Safe GET endpoints for endpoint probe
    if (url.endsWith("/health") || url.endsWith("/status")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Default: 404
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("EPIC-87 comprehensive E2E", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("full scan with all features produces evidence for all EPIC-87 rules", async () => {
    const state = await scanDomain(BASE_URL, {
      resources: [
        "homepage_meta",
        "operational_discovery",
        "oauth_authorization_server",
        "auth_probe",
        "openapi",
        "endpoint_probe",
      ],
      authTest: true,
      clientId: "test-id",
      clientSecret: "test-secret",
      probe: true,
      probeEndpoints: 3,
    });

    // Verify key snapshots exist
    expect(state.snapshots.operational_discovery).toBeDefined();
    expect(state.snapshots.operational_discovery).not.toBeNull();
    expect(state.snapshots.auth_probe).toBeDefined();
    expect(state.snapshots.auth_probe).not.toBeNull();
    expect(state.snapshots.endpoint_probe).toBeDefined();
    expect(state.snapshots.endpoint_probe).not.toBeNull();

    // Run rules
    const result = RuleEngine.run(state);

    // Verify all EPIC-87 rules produced assertions
    const epic87Rules = [
      // Auth probe
      "AB-119", "AB-120", "AB-121",
      // Endpoint probe
      "AB-122", "AB-123", "AB-124",
      // Operational discovery
      "AB-125", "AB-126", "AB-127",
    ];
    for (const ruleId of epic87Rules) {
      const found = result.assertions.find((a) => a.rule_id === ruleId);
      expect(found, `Rule ${ruleId} should produce an assertion`).toBeDefined();
    }

    // Verify scoring + funnel computation works
    const manifest = {
      name: AGENT_READINESS_RULESET.name,
      version: AGENT_READINESS_RULESET.version,
      categoryWeights: {
        discovery: 15, documentation: 15, actionability: 10,
        machine_readable: 10, verification: 5, content_negotiation: 10,
        payments: 10, bazaar: 5, openapi: 10, skills: 5,
        agents_txt: 5, webmcp: 5, identity: 5, bot_auth: 5,
        infrastructure: 5, seo_aeo: 5, accessibility: 4,
        active_probing: 5,
      },
    };
    const scoreResult = runScoringEngine({
      assertions: result.assertions as any,
      rulesetManifest: manifest,
    });

    const categoryScores: Record<string, number> = {};
    for (const [k, v] of Object.entries(scoreResult.categories)) {
      categoryScores[k] = (v as any).score ?? 0;
    }
    const funnel = computeFunnel(categoryScores);
    expect(funnel.stages).toHaveLength(6);
    expect(funnel.dropOff).toHaveLength(5);
  }, 30000);

  it("scan without optional flags only runs operational_discovery (not auth_probe or endpoint_probe)", async () => {
    const state = await scanDomain(BASE_URL, {
      resources: ["homepage_meta", "operational_discovery"],
    });

    // operational_discovery is in DEFAULT_RESOURCES, so it should be present
    expect(state.snapshots.operational_discovery).toBeDefined();
    expect(state.snapshots.operational_discovery).not.toBeNull();

    // auth_probe and endpoint_probe should NOT be present without flags
    expect(state.snapshots.auth_probe).toBeUndefined();
    expect(state.snapshots.endpoint_probe).toBeUndefined();
  }, 30000);
});
