import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { registerScanCommand } from "../../../../src/agent-readiness/cli/commands/scan";
import { runCommand, clearCommands } from "../../../../src/agent-readiness/cli/router";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

function mockResponse(status: number, body: string, headers: Record<string, string> = {}) {
  const bodyBytes = new TextEncoder().encode(body);
  return {
    status,
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bodyBytes);
        controller.close();
      },
    }),
  } as Response;
}

beforeEach(() => {
  clearCommands();
  registerScanCommand();
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve4.mockResolvedValue(["93.184.216.34"]);
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scan command", () => {
  it("is registered with correct name", () => {
    const result = runCommand(["scan", "--help"]);
    // --help is not yet implemented (slice 37-9), so it will try to run
    // Just verify the command is registered by checking it doesn't say "Unknown command"
    return expect(result).resolves.not.toMatchObject({ stderr: expect.stringContaining("Unknown command") });
  });

  it("returns error for missing URL argument", async () => {
    const result = await runCommand(["scan"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
    expect(result.stderr).toContain("url");
  });

  it("runs full scan pipeline and returns report JSON with --json", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("robots.txt")) return mockResponse(200, "User-agent: *", { "content-type": "text/plain" });
      if (u.includes("sitemap.xml")) return mockResponse(200, "<urlset/>", { "content-type": "application/xml" });
      if (u.includes("agent-guide")) return mockResponse(200, '{"name":"test"}', { "content-type": "application/json" });
      if (u.includes("openapi")) return mockResponse(200, '{"openapi":"3.0"}', { "content-type": "application/json" });
      if (u.includes("mcp.json")) return mockResponse(200, '{"version":"1"}', { "content-type": "application/json" });
      return mockResponse(404, "");
    });

    const result = await runCommand(["scan", "--json", "https://example.com"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
    const report = JSON.parse(result.stdout);
    expect(report.report_id).toBeTruthy();
    expect(report.schema_version).toBe("0.3.0");
    expect(report.ruleset.name).toBe("agent-readiness");
    expect(report.score.overall).toBeTypeOf("number");
    expect(report.assertions).toBeInstanceOf(Array);
    expect(report.integrity).toBeDefined();
    expect(report.integrity.content_hash).toBeTruthy();
  });

  it("writes report file without --json flag", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("robots.txt")) return mockResponse(200, "User-agent: *", { "content-type": "text/plain" });
      if (u.includes("sitemap.xml")) return mockResponse(200, "<urlset/>", { "content-type": "application/xml" });
      if (u.includes("agent-guide")) return mockResponse(200, '{"name":"test"}', { "content-type": "application/json" });
      if (u.includes("openapi")) return mockResponse(200, '{"openapi":"3.0"}', { "content-type": "application/json" });
      if (u.includes("mcp.json")) return mockResponse(200, '{"version":"1"}', { "content-type": "application/json" });
      return mockResponse(404, "");
    });

    const result = await runCommand(["scan", "--output", "/tmp/test-scan-report.json", "https://example.com"]);
    expect(result.exitCode).toBe(0);
    expect(result.outputFile).toBe("/tmp/test-scan-report.json");
    expect(result.stdout).toContain("Report written");
  });

  it("handles scan errors gracefully", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const result = await runCommand(["scan", "--json", "https://example.com"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error");
  });
});
