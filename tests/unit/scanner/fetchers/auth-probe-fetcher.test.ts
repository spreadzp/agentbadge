import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAuthProbe, type AuthProbeResult } from "../../../../src/agent-readiness/scanner/fetchers/auth-probe-fetcher";
import type { ResponseSnapshot } from "../../../../src/agent-readiness/scanner/snapshot";

function makeSnapshot(body: string | null): ResponseSnapshot {
  return {
    url: "https://api.example.com/.well-known/oauth-authorization-server",
    status: 200,
    bodyHash: "abc",
    bodySize: body?.length ?? 0,
    contentType: "application/json",
    resolvedIp: "1.2.3.4",
    fetchedAt: "2026-01-01T00:00:00Z",
    fetchTimeMs: 100,
    redirectChain: [],
    body,
    headers: {},
  };
}

describe("auth-probe-fetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no_oauth_metadata when oauth snapshot is null", async () => {
    const result = await fetchAuthProbe("https://api.example.com", null);
    expect(result.status).toBe("no_oauth_metadata");
    expect(result.tokenObtained).toBe(false);
  });

  it("returns no_oauth_metadata when snapshot body is null", async () => {
    const result = await fetchAuthProbe("https://api.example.com", makeSnapshot(null));
    expect(result.status).toBe("no_oauth_metadata");
    expect(result.tokenObtained).toBe(false);
  });

  it("returns no_oauth_metadata when body is invalid JSON", async () => {
    const result = await fetchAuthProbe("https://api.example.com", makeSnapshot("not json"));
    expect(result.status).toBe("no_oauth_metadata");
    expect(result.tokenObtained).toBe(false);
  });

  it("returns no_oauth_metadata when token_endpoint missing", async () => {
    const result = await fetchAuthProbe(
      "https://api.example.com",
      makeSnapshot(JSON.stringify({ grant_types_supported: ["client_credentials"] })),
    );
    expect(result.status).toBe("no_oauth_metadata");
    expect(result.tokenObtained).toBe(false);
  });

  it("returns not_supported when client_credentials not in grant_types", async () => {
    const snapshot = makeSnapshot(
      JSON.stringify({
        token_endpoint: "https://api.example.com/oauth/token",
        grant_types_supported: ["authorization_code", "refresh_token"],
      }),
    );
    const result = await fetchAuthProbe("https://api.example.com", snapshot);
    expect(result.status).toBe("not_supported");
    expect(result.tokenObtained).toBe(false);
    expect(result.tokenEndpoint).toBe("https://api.example.com/oauth/token");
  });

  it("returns credentials_required when no credentials provided", async () => {
    const snapshot = makeSnapshot(
      JSON.stringify({
        token_endpoint: "https://api.example.com/oauth/token",
        grant_types_supported: ["client_credentials"],
      }),
    );
    const result = await fetchAuthProbe("https://api.example.com", snapshot);
    expect(result.status).toBe("credentials_required");
    expect(result.tokenObtained).toBe(false);
    expect(result.tokenEndpoint).toBe("https://api.example.com/oauth/token");
  });

  it("returns success when token obtained and endpoint returns 200", async () => {
    const snapshot = makeSnapshot(
      JSON.stringify({
        token_endpoint: "https://api.example.com/oauth/token",
        grant_types_supported: ["client_credentials"],
      }),
    );
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "https://api.example.com/oauth/token" && opts?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "test-token-123", token_type: "Bearer" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      // Protected endpoint probe
      return Promise.resolve(new Response("OK", { status: 200 }));
    });

    const result = await fetchAuthProbe(
      "https://api.example.com",
      snapshot,
      { clientId: "test-id", clientSecret: "test-secret" },
      mockFetch as unknown as typeof fetch,
    );
    expect(result.status).toBe("success");
    expect(result.tokenObtained).toBe(true);
    expect(result.endpointStatus).toBe(200);
    expect(result.grantType).toBe("client_credentials");
  });

  it("returns token_error when token endpoint returns 401", async () => {
    const snapshot = makeSnapshot(
      JSON.stringify({
        token_endpoint: "https://api.example.com/oauth/token",
        grant_types_supported: ["client_credentials"],
      }),
    );
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }),
    );

    const result = await fetchAuthProbe(
      "https://api.example.com",
      snapshot,
      { clientId: "bad-id", clientSecret: "bad-secret" },
      mockFetch as unknown as typeof fetch,
    );
    expect(result.status).toBe("token_error");
    expect(result.tokenObtained).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns token_error when response has no access_token", async () => {
    const snapshot = makeSnapshot(
      JSON.stringify({
        token_endpoint: "https://api.example.com/oauth/token",
        grant_types_supported: ["client_credentials"],
      }),
    );
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ foo: "bar" }), { status: 200 }),
    );

    const result = await fetchAuthProbe(
      "https://api.example.com",
      snapshot,
      { clientId: "test-id", clientSecret: "test-secret" },
      mockFetch as unknown as typeof fetch,
    );
    expect(result.status).toBe("token_error");
    expect(result.tokenObtained).toBe(false);
    expect(result.error).toContain("access_token");
  });

  it("returns endpoint_error when protected endpoint returns 401", async () => {
    const snapshot = makeSnapshot(
      JSON.stringify({
        token_endpoint: "https://api.example.com/oauth/token",
        grant_types_supported: ["client_credentials"],
      }),
    );
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("Unauthorized", { status: 401 }));
    });

    const result = await fetchAuthProbe(
      "https://api.example.com",
      snapshot,
      { clientId: "test-id", clientSecret: "test-secret" },
      mockFetch as unknown as typeof fetch,
    );
    expect(result.status).toBe("endpoint_error");
    expect(result.tokenObtained).toBe(true);
    expect(result.endpointStatus).toBe(401);
  });

  it("never exposes credentials or tokens in result", async () => {
    const snapshot = makeSnapshot(
      JSON.stringify({
        token_endpoint: "https://api.example.com/oauth/token",
        grant_types_supported: ["client_credentials"],
      }),
    );
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "secret-token-value" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("OK", { status: 200 }));
    });

    const result = await fetchAuthProbe(
      "https://api.example.com",
      snapshot,
      { clientId: "secret-id", clientSecret: "secret-value" },
      mockFetch as unknown as typeof fetch,
    );
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("secret-id");
    expect(resultStr).not.toContain("secret-value");
    expect(resultStr).not.toContain("secret-token-value");
  });
});
