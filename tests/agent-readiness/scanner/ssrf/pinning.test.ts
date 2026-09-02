/**
 * SLICE-85-1: IP-Pinned Transport for safeFetch
 *
 * Tests:
 * 1. fetchPinned rewrites URL to use validated IP, preserves Host header
 * 2. DNS rebinding: second resolve returns private IP, but fetch connects to first validated IP
 * 3. Redirect to hostname resolving private → blocked (existing behavior preserved)
 * 4. Hex-encoded loopback host (2130706433) rejected by canonical guard, not inline blocklist
 * 5. total-scan-api no longer contains its own blocklist
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { safeFetch } from "../../../../src/agent-readiness/scanner/ssrf/safe-fetch";
import { fetchPinned } from "../../../../src/agent-readiness/scanner/ssrf/pinned-fetch";
import {
  SsrfRedirectError,
} from "../../../../src/agent-readiness/scanner/ssrf/scanner-error";
import { assertSafeTarget } from "../../../../src/agent-readiness/scanner/ssrf/ip-guard";

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

function mockRedirect(location: string) {
  return mockResponse(302, "", { location });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SLICE-85-1: fetchPinned", () => {
  it("rewrites URL to use validated IP and sets Host header", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(mockResponse(200, "OK"));

    await fetchPinned("https://example.com/path", "93.184.216.34", {
      headers: { "User-Agent": "test" },
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const calledOpts = mockFetch.mock.calls[0][1] as Record<string, unknown>;

    // URL should contain the IP, not the hostname
    expect(calledUrl).toContain("93.184.216.34");
    expect(calledUrl).not.toContain("example.com");
    expect(calledUrl).toBe("https://93.184.216.34/path");

    // Host header should preserve original hostname
    const headers = calledOpts.headers as Record<string, string>;
    expect(headers["Host"]).toBe("example.com");

    // tls.servername should be set for HTTPS SNI
    const tls = calledOpts.tls as Record<string, unknown>;
    expect(tls?.servername).toBe("example.com");
  });

  it("preserves port in rewritten URL", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(mockResponse(200, "OK"));

    await fetchPinned("http://example.com:8080/path", "93.184.216.34");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe("http://93.184.216.34:8080/path");
  });

  it("does not set tls.servername for HTTP URLs", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(mockResponse(200, "OK"));

    await fetchPinned("http://example.com/path", "93.184.216.34");

    const calledOpts = mockFetch.mock.calls[0][1] as Record<string, unknown>;
    expect(calledOpts.tls).toBeUndefined();
  });
});

describe("SLICE-85-1: DNS rebinding prevention", () => {
  it("connects to first validated IP even if DNS rotates to private on re-resolve", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(mockResponse(200, "OK"));

    // First resolve (by resolveAndPin) returns public IP
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockResolvedValueOnce([]);

    // If Bun re-resolves, it would get 127.0.0.1 — but we pin to the first IP
    // The fetch should be called with the pinned IP, not the hostname
    await safeFetch("https://example.com/");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    // Must connect to the validated IP, not re-resolve the hostname
    expect(calledUrl).toContain("93.184.216.34");
    expect(calledUrl).not.toContain("example.com");
  });

  it("redirect to hostname resolving private IP is blocked", async () => {
    const mockFetch = vi.mocked(fetch);

    // First hop: public IP, returns redirect
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce(mockRedirect("https://evil.com/"));

    // Second hop: evil.com resolves to private IP
    mockResolve4.mockResolvedValueOnce(["127.0.0.1"]);
    mockResolve6.mockResolvedValueOnce([]);

    await expect(safeFetch("https://example.com/")).rejects.toThrow(SsrfRedirectError);
  });
});

describe("SLICE-85-1: Canonical SSRF guard (no duplicate blocklist)", () => {
  it("hex-encoded loopback (2130706433) is rejected by canonical guard", () => {
    // 2130706433 = 127.0.0.1 in decimal
    expect(() => assertSafeTarget("2130706433")).toThrow();
  });

  it("octal loopback (0177.0.0.1) is rejected by canonical guard", () => {
    // 0177 = 127 in octal — naive string blocklist would miss this
    expect(() => assertSafeTarget("0177.0.0.1")).toThrow();
  });

  it("IPv6 loopback (::1) is rejected by canonical guard", () => {
    expect(() => assertSafeTarget("::1")).toThrow();
  });

  it("normal hostname is not rejected", () => {
    expect(() => assertSafeTarget("example.com")).not.toThrow();
  });
});

describe("SLICE-85-1: total-scan-api has no inline blocklist", () => {
  it("total-scan-api.ts does not contain privateRanges array", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../../../src/server/routes/total-scan-api.ts"),
      "utf-8",
    );

    // The duplicate weak blocklist should be gone
    expect(content).not.toContain("privateRanges");
    expect(content).not.toContain('"127."');
    expect(content).not.toContain('"192.168."');
    expect(content).not.toContain('"10."');
  });
});
