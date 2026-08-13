import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock scanner + rule engine
vi.mock("../../src/agent-readiness/scanner/orchestrator", () => ({
  scanDomain: vi.fn().mockResolvedValue({ snapshots: {} }),
}));

vi.mock("../../src/agent-readiness/rule-engine/rule-engine", () => ({
  RuleEngine: {
    run: vi.fn().mockReturnValue({
      assertions: [
        { rule_id: "AB-001", status: "VERIFIED", evidence: [{ source: "robots" }], category: "discovery", name: "robots.txt" },
        { rule_id: "AB-002", status: "MISSING", evidence: [], category: "discovery", name: "sitemap" },
        { rule_id: "AB-003", status: "NOT_APPLICABLE", evidence: [], category: "payments", name: "x402" },
      ],
    }),
  },
}));

vi.mock("../../src/agent-readiness/ruleset", () => ({
  AGENT_READINESS_RULESET: { rules: [] },
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
