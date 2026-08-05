/**
 * SLICE-37-10: CLI Integration Tests — End-to-End Command Tests
 * Tests the full pipeline: scan → verify-report → fix → badge
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { runCommand, clearCommands } from "../../../src/agent-readiness/cli/router";
import { registerScanCommand } from "../../../src/agent-readiness/cli/commands/scan";
import { registerVerifyCommand } from "../../../src/agent-readiness/cli/commands/verify-report";
import { registerFixCommand } from "../../../src/agent-readiness/cli/commands/fix";
import { registerBadgeCommand } from "../../../src/agent-readiness/cli/commands/badge";
import { generateSigningKey, savePublicKey, saveSigningKey, loadSigningKey } from "../../../src/agent-readiness/integrity/key-manager";
import { signContentHash } from "../../../src/agent-readiness/integrity/signer";

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

let tempDir: string;

beforeEach(async () => {
  clearCommands();
  registerScanCommand();
  registerVerifyCommand();
  registerFixCommand();
  registerBadgeCommand();
  tempDir = await mkdtemp(join(tmpdir(), "agentbadge-e2e-"));
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve4.mockResolvedValue(["93.184.216.34"]);
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CLI integration: scan → verify-report → fix → badge", () => {
  it("runs full pipeline end-to-end", async () => {
    // Setup mocks
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("robots.txt")) return mockResponse(200, "User-agent: *", { "content-type": "text/plain" });
      if (u.includes("sitemap.xml")) return mockResponse(200, "<urlset/>", { "content-type": "application/xml" });
      if (u.includes("agent-guide")) return mockResponse(200, '{"name":"test"}', { "content-type": "application/json" });
      if (u.includes("openapi")) return mockResponse(200, '{"openapi":"3.0"}', { "content-type": "application/json" });
      if (u.includes("mcp.json")) return mockResponse(200, '{"version":"1"}', { "content-type": "application/json" });
      return mockResponse(404, "");
    });

    // Step 1: Scan
    const reportPath = join(tempDir, "report.json");
    const scanResult = await runCommand(["scan", "--output", reportPath, "https://example.com"]);
    expect(scanResult.exitCode).toBe(0);
    expect(scanResult.outputFile).toBe(reportPath);

    const report = JSON.parse(await readFile(reportPath, "utf-8"));
    expect(report.report_id).toBeTruthy();
    expect(report.score.overall).toBeTypeOf("number");

    // Step 2: Generate keys and sign report
    const key = generateSigningKey("integration-key");
    const keyPath = join(tempDir, "key.json");
    const pubKeyPath = join(tempDir, "pub.json");
    await saveSigningKey(key, keyPath);
    await savePublicKey(key, pubKeyPath);
    const loadedKey = await loadSigningKey(keyPath);
    report.integrity.signature.value = signContentHash(report.integrity.content_hash, loadedKey);
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

    // Step 3: Verify report
    const verifyResult = await runCommand(["verify-report", reportPath, "--public-key", pubKeyPath]);
    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.stdout).toContain("VERIFIED");

    // Step 4: Generate fix suggestions
    const fixPath = join(tempDir, "fixes.json");
    const fixResult = await runCommand(["fix", reportPath, "--output", fixPath]);
    expect(fixResult.exitCode).toBe(0);
    const fixes = JSON.parse(await readFile(fixPath, "utf-8"));
    expect(fixes).toBeInstanceOf(Array);

    // Step 5: Generate badge
    const badgePath = join(tempDir, "badge.svg");
    const badgeResult = await runCommand(["badge", reportPath, "--output", badgePath]);
    expect(badgeResult.exitCode).toBe(0);
    const svg = await readFile(badgePath, "utf-8");
    expect(svg).toContain("<svg");
    expect(svg).toContain(`${report.score.overall}/100`);
  });

  it("scan with --json outputs valid JSON report to stdout", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
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
    const report = JSON.parse(result.stdout);
    expect(report.report_id).toBeTruthy();
    expect(report.integrity.content_hash).toHaveLength(64);
  });

  it("unknown command returns helpful error", async () => {
    const result = await runCommand(["nonexistent-command"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
    expect(result.stderr).toContain("--help");
  });
});
