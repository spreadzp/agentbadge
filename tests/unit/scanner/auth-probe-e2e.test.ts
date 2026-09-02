import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/agent-readiness/scanner/ssrf/dns-pin", () => ({
  resolveAndPin: async (hostname: string) => ({ ip: "93.184.216.34", hostname }),
}));

import { scanDomain } from "../../../src/agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";

const BASE_URL = "http://localhost:8080";

const OAuth_METADATA = JSON.stringify({
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

    // OAuth authorization server metadata
    if (url.includes(".well-known/oauth-authorization-server")) {
      return new Response(OAuth_METADATA, { status: 200, headers: { "content-type": "application/json" } });
    }

    // Token endpoint
    if (url.includes("oauth/token") && init?.method === "POST") {
      return new Response(TOKEN_RESPONSE, { status: 200, headers: { "content-type": "application/json" } });
    }

    // Protected endpoint (any GET with Authorization header)
    if (init?.headers && (init.headers as Record<string, string>)["Authorization"]) {
      return new Response(JSON.stringify({ data: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    }

    // Default: 404
    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("auth probe E2E", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("full scan with auth-test produces auth probe snapshot and AB-119/120/121 evidence", async () => {
    const state = await scanDomain(BASE_URL, {
      resources: ["oauth_authorization_server", "auth_probe"],
      authTest: true,
      clientId: "test-id",
      clientSecret: "test-secret",
    });

    // Verify auth_probe snapshot exists
    expect(state.snapshots.auth_probe).toBeDefined();
    expect(state.snapshots.auth_probe).not.toBeNull();

    // Run rules
    const result = RuleEngine.run(state);

    // Verify AB-119, AB-120, AB-121 are present
    const ab119 = result.assertions.find((a) => a.rule_id === "AB-119");
    const ab120 = result.assertions.find((a) => a.rule_id === "AB-120");
    const ab121 = result.assertions.find((a) => a.rule_id === "AB-121");

    expect(ab119).toBeDefined();
    expect(ab120).toBeDefined();
    expect(ab121).toBeDefined();
  }, 15000);

  it("scan without authTest does not produce auth probe snapshot", async () => {
    const state = await scanDomain(BASE_URL, {
      resources: ["oauth_authorization_server"],
    });

    expect(state.snapshots.auth_probe).toBeUndefined();
  }, 15000);

  it("scan with authTest but without credentials does not produce auth probe snapshot", async () => {
    const state = await scanDomain(BASE_URL, {
      resources: ["oauth_authorization_server"],
      authTest: true,
    });

    // Without credentials, auth probe should not produce a snapshot
    expect(state.snapshots.auth_probe).toBeUndefined();
  }, 15000);
});
