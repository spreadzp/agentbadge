import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { safeFetch } from "../src/agent-readiness/scanner/ssrf/safe-fetch";
import {
  SsrfRedirectError,
  RedirectLimitError,
  RedirectLoopError,
  ResponseTooLargeError,
  ScannerError,
  ScannerErrorCodes,
} from "../src/agent-readiness/scanner/ssrf/scanner-error";

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

describe("safeFetch", () => {
  it("returns 200 with body and resolved IP", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, "User-agent: *\nDisallow: /private", { "content-type": "text/plain" }),
    );

    const result = await safeFetch("https://example.com/robots.txt");
    expect(result.status).toBe(200);
    expect(result.bodyText).toContain("User-agent");
    expect(result.resolvedIp).toBe("93.184.216.34");
    expect(result.redirectChain).toEqual([]);
  });

  it("sets User-Agent to AgentBadge/0.1", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(200, "ok"));

    await safeFetch("https://example.com/test");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "AgentBadge/0.1 (+https://agentbadge.dev)" }),
      }),
    );
  });

  it("only sends GET requests", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(200, "ok"));

    await safeFetch("https://example.com/test");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws SsrfRedirectError when redirect targets blocked IP", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));
    vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("http://127.0.0.1/secret"));

    // Second resolve for the redirect target
    mockResolve4.mockResolvedValueOnce(["127.0.0.1"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));

    await expect(safeFetch("https://example.com/redirect")).rejects.toThrow(SsrfRedirectError);
  });

  it("throws RedirectLimitError when exceeding maxRedirects", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockRejectedValue(new Error("no AAAA"));

    // Each hop returns a redirect
    vi.mocked(fetch).mockResolvedValue(mockRedirect("https://example.com/r2"));
    vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://example.com/r1"));
    vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://example.com/r2"));
    vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://example.com/r3"));
    vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://example.com/r4"));

    await expect(safeFetch("https://example.com/start", { maxRedirects: 3 })).rejects.toThrow(RedirectLimitError);
  });

  it("throws RedirectLoopError when URL redirects to itself", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockRejectedValue(new Error("no AAAA"));
    vi.mocked(fetch).mockResolvedValue(mockRedirect("https://example.com/loop"));

    await expect(safeFetch("https://example.com/loop")).rejects.toThrow(RedirectLoopError);
  });

  it("throws ResponseTooLargeError when response exceeds maxResponseSize", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));

    const bigBody = "x".repeat(100);
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(200, bigBody));

    await expect(
      safeFetch("https://example.com/big", { maxResponseSize: 50 }),
    ).rejects.toThrow(ResponseTooLargeError);
  });

  it("retries once on 5xx and returns the retry result", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockRejectedValue(new Error("no AAAA"));

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(mockResponse(200, "OK on retry"));

    const result = await safeFetch("https://example.com/flaky");
    expect(result.status).toBe(200);
    expect(result.bodyText).toBe("OK on retry");
  });

  it("captures redirectChain in result", async () => {
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockResolve6.mockRejectedValue(new Error("no AAAA"));

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockRedirect("https://example.com/step2"))
      .mockResolvedValueOnce(mockResponse(200, "final"));

    const result = await safeFetch("https://example.com/step1");
    expect(result.redirectChain).toEqual(["https://example.com/step1"]);
    expect(result.bodyText).toBe("final");
  });

  it("throws ContentTypeMismatchError when content-type not in allowed list", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, "<html></html>", { "content-type": "text/html" }),
    );

    await expect(
      safeFetch("https://example.com/test", { allowedContentTypes: ["application/json"] }),
    ).rejects.toThrow(ScannerError);
  });
});
