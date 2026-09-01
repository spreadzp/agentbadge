import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock scanner + rule engine
vi.mock("../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn().mockImplementation(async (url: string, opts?: { onProgress?: (resource: string, completed: number, total: number) => void }) => {
    // Simulate progress callbacks for a few resources
    const resources = ["robots", "sitemap", "openapi"];
    resources.forEach((r, i) => opts?.onProgress?.(r, i + 1, resources.length));
    return { snapshots: {} };
  }),
}));

vi.mock("../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: [
        { rule_id: "AB-001", status: "VERIFIED", evidence: [{ source: "robots" }], category: "discovery", name: "robots.txt" },
        { rule_id: "AB-002", status: "GAP", evidence: [], category: "discovery", name: "sitemap" },
        { rule_id: "AB-003", status: "NOT_APPLICABLE", evidence: [], category: "payments", name: "x402" },
      ],
    }),
  },
}));

vi.mock("../../src/agent-readiness/ruleset", () => ({
  AGENT_READINESS_RULESET: {
    name: "agent-readiness",
    version: "2.1.0",
    rules: [],
    scoring: {
      pillars: {
        weights: { discovery: 20, understandability: 25, executability: 30, verifiability: 25 },
        scoringModel: "v2-pillars" as const,
      },
    },
  },
}));

const { totalScanRoutes } = await import("../../src/server/routes/total-scan-api");

const app = new Hono();
app.route("/api", totalScanRoutes);

describe("SLICE-58-5: Total scan SSE endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for missing url", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("returns SSE stream for valid url", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(200);
    // streamText returns text/plain by default, but SSE format is in the body
    const text = await res.text();
    expect(text).toContain("event: progress");
    expect(text).toContain("event: result");
    expect(text).toContain("event: done");
  });

  it("progress events include fetching phase with resource names", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    expect(text).toContain('"phase":"fetching"');
    expect(text).toContain('"resource"');
    expect(text).toContain('"completed"');
    expect(text).toContain('"total"');
  });

  it("rejects private/localhost URLs with 403", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost:4021" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Private URLs");
  });

  it("rejects 192.168.x.x URLs with 403", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://192.168.1.1" }),
    });
    expect(res.status).toBe(403);
  });

  it("progress events include evaluating phase", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    expect(text).toContain('"phase":"evaluating"');
  });

  it("result event contains score and rules", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    // Extract the result event data
    const resultMatch = text.match(/event: result\ndata: (.+)/);
    expect(resultMatch).not.toBeNull();
    const result = JSON.parse(resultMatch![1]);
    expect(result.score).toBeDefined();
    expect(result.total_rules).toBe(3);
    expect(result.grade).toBeDefined();
    expect(result.categories).toBeDefined();
    expect(result.summary).toBeDefined();
    // SLICE-93-7: pillars field present in SSE result
    expect(result.pillars).toBeDefined();
    expect(Array.isArray(result.pillars)).toBe(true);
    expect(result.pillars).toHaveLength(4);
    expect(result.pillars[0]).toHaveProperty("pillar");
    expect(result.pillars[0]).toHaveProperty("label");
    expect(result.pillars[0]).toHaveProperty("weight");
    expect(result.pillars[0]).toHaveProperty("score");
  });

  it("done event contains completed: true", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const text = await res.text();
    expect(text).toContain('event: done');
    expect(text).toContain('"completed":true');
  });

  it("normalizes URL without protocol", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "example.com" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const resultMatch = text.match(/event: result\ndata: (.+)/);
    const result = JSON.parse(resultMatch![1]);
    expect(result.url).toBe("https://example.com");
  });
});
