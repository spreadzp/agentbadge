import { describe, it, expect, vi } from "vitest";
import { fetchAAuth } from "../../../src/agent-readiness/scanner/fetchers/aauth-fetcher";

describe("aauth-fetcher", () => {
  it("probes /.well-known/aauth.json and finds it", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/aauth.json")) {
        return new Response(JSON.stringify({
          scope_descriptions: [
            { scope: "urn:example:resource.read", description: "Read resource" },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/oauth-authorization-server")) {
        return new Response(JSON.stringify({
          grant_types_supported: ["client_credentials"],
          token_endpoint: "https://auth.example.com/token",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    const result = await fetchAAuth("https://example.com", mockFetch);
    expect(result.source).toBe("aauth");
    expect(result.data.aauthFound).toBe(true);
    expect(result.data.scopeDescriptions).toHaveLength(1);
    expect(result.data.scopeDescriptions[0].scope).toBe("urn:example:resource.read");
  });

  it("detects agent_authorization grant in OAuth metadata", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/aauth.json")) {
        return new Response(null, { status: 404 });
      }
      if (url.includes("/oauth-authorization-server")) {
        return new Response(JSON.stringify({
          grant_types_supported: [
            "client_credentials",
            "urn:ietf:params:oauth:grant-type:agent_authorization",
          ],
          token_endpoint: "https://auth.example.com/token",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    const result = await fetchAAuth("https://example.com", mockFetch);
    expect(result.data.aauthFound).toBe(false);
    expect(result.data.agentGrantSupported).toBe(true);
    expect(result.data.tokenEndpoint).toBe("https://auth.example.com/token");
  });

  it("handles both aauth.json and agent grant present", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/aauth.json")) {
        return new Response(JSON.stringify({
          scope_descriptions: [
            { scope: "agent:read", description: "Agent read access" },
            { scope: "agent:write", description: "Agent write access" },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/oauth-authorization-server")) {
        return new Response(JSON.stringify({
          grant_types_supported: [
            "client_credentials",
            "urn:ietf:params:oauth:grant-type:agent_authorization",
          ],
          token_endpoint: "https://auth.example.com/token",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    const result = await fetchAAuth("https://example.com", mockFetch);
    expect(result.data.aauthFound).toBe(true);
    expect(result.data.agentGrantSupported).toBe(true);
    expect(result.data.scopeDescriptions).toHaveLength(2);
  });

  it("handles 404 gracefully for both endpoints", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const result = await fetchAAuth("https://example.com", mockFetch);
    expect(result.data.aauthFound).toBe(false);
    expect(result.data.agentGrantSupported).toBe(false);
    expect(result.data.scopeDescriptions).toEqual([]);
    expect(result.data.tokenEndpoint).toBeNull();
  });

  it("handles network errors gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await fetchAAuth("https://example.com", mockFetch);
    expect(result.data.aauthFound).toBe(false);
    expect(result.data.agentGrantSupported).toBe(false);
    expect(result.data.scopeDescriptions).toEqual([]);
    expect(result.data.tokenEndpoint).toBeNull();
  });

  it("handles invalid JSON in aauth.json", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/aauth.json")) {
        return new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    const result = await fetchAAuth("https://example.com", mockFetch);
    expect(result.data.aauthFound).toBe(false);
    expect(result.data.scopeDescriptions).toEqual([]);
  });

  it("handles missing grant_types_supported in OAuth metadata", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/oauth-authorization-server")) {
        return new Response(JSON.stringify({
          token_endpoint: "https://auth.example.com/token",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    const result = await fetchAAuth("https://example.com", mockFetch);
    expect(result.data.agentGrantSupported).toBe(false);
    expect(result.data.tokenEndpoint).toBe("https://auth.example.com/token");
  });
});
