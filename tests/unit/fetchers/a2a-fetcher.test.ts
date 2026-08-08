import { describe, it, expect, vi } from "vitest";
import { fetchA2A } from "../../../src/agent-readiness/scanner/fetchers/a2a-fetcher";

describe("SLICE-48-8: a2a-fetcher", () => {
  it("fetches and validates agent-card.json", async () => {
    const card = {
      name: "AgentBadge",
      description: "Agent readiness scanner",
      url: "https://agentbadge.xyz",
      version: "1.0.0",
      capabilities: { mcp: {} },
    };
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await fetchA2A("https://example.com", mockFetch);
    expect(result.source).toBe("a2a");
    expect(result.data.found).toBe(true);
    expect(result.data.valid).toBe(true);
    expect(result.data.name).toBe("AgentBadge");
  });

  it("handles 404", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const result = await fetchA2A("https://example.com", mockFetch);
    expect(result.data.found).toBe(false);
  });

  it("detects invalid card (missing required fields)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "Foo" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await fetchA2A("https://example.com", mockFetch);
    expect(result.data.found).toBe(true);
    expect(result.data.valid).toBe(false);
  });
});
