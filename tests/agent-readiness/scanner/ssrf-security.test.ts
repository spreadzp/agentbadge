import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { isPrivateIp, isBlockedIp, assertSafeIp } from "../../../src/agent-readiness/scanner/ssrf/ip-guard";
import { resolveAndPin } from "../../../src/agent-readiness/scanner/ssrf/dns-pin";
import { safeFetch } from "../../../src/agent-readiness/scanner/ssrf/safe-fetch";
import { SsrfBlockedError } from "../../../src/agent-readiness/scanner/ssrf/ssrf-error";
import {
  SsrfRedirectError,
  RedirectLimitError,
  RedirectLoopError,
  TimeoutError,
  ResponseTooLargeError,
  ScannerError,
  ScannerErrorCodes,
} from "../../../src/agent-readiness/scanner/ssrf/scanner-error";

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

function mockLargeResponse(size: number) {
  const chunk = new Uint8Array(size);
  return {
    status: 200,
    headers: new Headers({ "content-type": "text/plain" }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    }),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSRF Security Test Suite — 24+ Attack Vectors", () => {
  describe("Direct private IP access", () => {
    it("1. blocks direct RFC1918 10.x.x.x", () => {
      expect(() => assertSafeIp("10.0.0.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("10.0.0.1")).toBe(true);
    });

    it("2. blocks loopback 127.0.0.1", () => {
      expect(() => assertSafeIp("127.0.0.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("127.0.0.1")).toBe(true);
    });

    it("3. blocks localhost via DNS resolution", async () => {
      mockResolve4.mockResolvedValueOnce(["127.0.0.1"]);
      await expect(resolveAndPin("localhost")).rejects.toThrow(SsrfBlockedError);
    });

    it("4. blocks IPv6 loopback ::1", () => {
      expect(() => assertSafeIp("::1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("::1")).toBe(true);
    });

    it("5. blocks cloud metadata 169.254.169.254", () => {
      expect(() => assertSafeIp("169.254.169.254")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("169.254.169.254")).toBe(true);
    });

    it("6. blocks AWS metadata v2 path via IP", () => {
      expect(isBlockedIp("169.254.169.254")).toBe(true);
    });

    it("7. blocks GCP metadata via DNS resolution", async () => {
      mockResolve4.mockResolvedValueOnce(["169.254.169.254"]);
      await expect(resolveAndPin("metadata.google.internal")).rejects.toThrow(SsrfBlockedError);
    });

    it("8. blocks Azure metadata via IP", () => {
      expect(isPrivateIp("169.254.169.254")).toBe(true);
    });
  });

  describe("Redirect to private IP", () => {
    it("9. blocks redirect to 10.0.0.1", async () => {
      // First hop: public IP
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("http://10.0.0.1/robots.txt"));
      // Second hop: DNS resolves to private
      mockResolve4.mockResolvedValueOnce(["10.0.0.1"]);

      await expect(safeFetch("https://example.com/robots.txt")).rejects.toThrow(SsrfRedirectError);
    });

    it("10. blocks redirect to 127.0.0.1", async () => {
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("http://127.0.0.1/"));
      mockResolve4.mockResolvedValueOnce(["127.0.0.1"]);

      await expect(safeFetch("https://example.com/")).rejects.toThrow(SsrfRedirectError);
    });

    it("11. blocks redirect to metadata 169.254.169.254", async () => {
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("http://169.254.169.254/latest/meta-data/"));
      mockResolve4.mockResolvedValueOnce(["169.254.169.254"]);

      await expect(safeFetch("https://example.com/")).rejects.toThrow(SsrfRedirectError);
    });
  });

  describe("DNS rebinding", () => {
    it("12. blocks DNS rebinding — first resolve public, second private", async () => {
      // First resolution: public IP
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://evil.com/data"));
      // Second resolution (redirect hop): private IP
      mockResolve4.mockResolvedValueOnce(["10.0.0.1"]);

      await expect(safeFetch("https://evil.com/initial")).rejects.toThrow(SsrfRedirectError);
    });
  });

  describe("IPv4-mapped IPv6", () => {
    it("13. blocks IPv4-mapped IPv6 ::ffff:127.0.0.1", () => {
      expect(() => assertSafeIp("::ffff:127.0.0.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    });
  });

  describe("Alternative IP encodings", () => {
    it("14. blocks decimal IP 2130706433 (127.0.0.1 as integer)", () => {
      // assertSafeIp rejects unparseable IPs (not dotted, not IPv6)
      expect(() => assertSafeIp("2130706433")).toThrow(SsrfBlockedError);
    });

    it("15. blocks hex IP 0x7f000001 (127.0.0.1 as hex)", () => {
      // Node URL parser may not parse hex IPs
      // assertSafeIp should reject unparseable IPs
      expect(() => assertSafeIp("0x7f000001")).toThrow(SsrfBlockedError);
    });

    it("16. blocks octal IP 0177.0.0.1 (127.0.0.1 as octal)", () => {
      // assertSafeIp should reject unparseable IPs
      expect(() => assertSafeIp("0177.0.0.1")).toThrow(SsrfBlockedError);
    });
  });

  describe("Zero / unspecified addresses", () => {
    it("17. blocks 0.0.0.0", () => {
      expect(() => assertSafeIp("0.0.0.0")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("0.0.0.0")).toBe(true);
    });
  });

  describe("Redirect loops and chains", () => {
    it("18. blocks redirect loop A → B → A", async () => {
      mockResolve4.mockResolvedValue(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://b.com/loop"));
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://a.com/loop"));

      await expect(safeFetch("https://a.com/loop")).rejects.toThrow(RedirectLoopError);
    });

    it("19. blocks redirect chain A → B → C → 10.0.0.1", async () => {
      // Hop 0: a.com → public
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://b.com/hop1"));
      // Hop 1: b.com → public
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://c.com/hop2"));
      // Hop 2: c.com → public
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("http://10.0.0.1/final"));
      // Hop 3: 10.0.0.1 → private (blocked)
      mockResolve4.mockResolvedValueOnce(["10.0.0.1"]);

      await expect(safeFetch("https://a.com/start")).rejects.toThrow(SsrfRedirectError);
    });
  });

  describe("Response size and timeout attacks", () => {
    it("20. blocks oversized response > 5MB", async () => {
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockLargeResponse(6 * 1024 * 1024));

      await expect(safeFetch("https://example.com/large")).rejects.toThrow(ResponseTooLargeError);
    });

    it("21. blocks timeout — server hangs indefinitely", async () => {
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          // Simulate AbortError after timeout
          setTimeout(() => {
            const err = new DOMException("The operation was aborted", "AbortError");
            reject(err);
          }, 50);
        });
      });

      await expect(
        safeFetch("https://example.com/slow", { timeout: { connect: 5_000, total: 10 } }),
      ).rejects.toThrow(TimeoutError);
    });
  });

  describe("RFC1918 ranges", () => {
    it("22. blocks RFC1918 172.16.0.1", () => {
      expect(() => assertSafeIp("172.16.0.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("172.16.0.1")).toBe(true);
    });

    it("23. blocks RFC1918 192.168.1.1", () => {
      expect(() => assertSafeIp("192.168.1.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("192.168.1.1")).toBe(true);
    });
  });

  describe("IPv6 ULA", () => {
    it("24. blocks IPv6 ULA fc00::1", () => {
      expect(() => assertSafeIp("fc00::1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("fc00::1")).toBe(true);
    });

    it("25. blocks IPv6 ULA fd00::1", () => {
      expect(() => assertSafeIp("fd00::1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("fd00::1")).toBe(true);
    });
  });

  describe("Additional edge cases", () => {
    it("26. blocks IPv6 link-local fe80::1", () => {
      expect(() => assertSafeIp("fe80::1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("fe80::1")).toBe(true);
    });

    it("27. blocks IPv6 unspecified ::", () => {
      expect(() => assertSafeIp("::")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("::")).toBe(true);
    });

    it("28. blocks carrier-grade NAT 100.64.0.1", () => {
      expect(() => assertSafeIp("100.64.0.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("100.64.0.1")).toBe(true);
    });

    it("29. blocks documentation range 192.0.2.1", () => {
      expect(() => assertSafeIp("192.0.2.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("192.0.2.1")).toBe(true);
    });

    it("30. blocks IPv4-mapped IPv6 ::ffff:10.0.0.1", () => {
      expect(() => assertSafeIp("::ffff:10.0.0.1")).toThrow(SsrfBlockedError);
      expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    });
  });

  describe("Error code verification", () => {
    it("31. SsrfBlockedError has code SSRF_BLOCKED", () => {
      try {
        assertSafeIp("10.0.0.1");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SsrfBlockedError);
        expect((e as SsrfBlockedError).code).toBe("SSRF_BLOCKED");
      }
    });

    it("32. SsrfRedirectError has code SSRF_REDIRECT_BLOCKED", async () => {
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("http://10.0.0.1/"));
      mockResolve4.mockResolvedValueOnce(["10.0.0.1"]);

      try {
        await safeFetch("https://example.com/");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SsrfRedirectError);
        expect((e as SsrfRedirectError).code).toBe("SSRF_REDIRECT_BLOCKED");
      }
    });

    it("33. RedirectLoopError has code REDIRECT_LOOP", async () => {
      mockResolve4.mockResolvedValue(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://b.com/"));
      vi.mocked(fetch).mockResolvedValueOnce(mockRedirect("https://a.com/"));

      try {
        await safeFetch("https://a.com/");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(RedirectLoopError);
        expect((e as RedirectLoopError).code).toBe("REDIRECT_LOOP");
      }
    });

    it("34. allows public IP through safeFetch", async () => {
      mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse(200, "OK", { "content-type": "text/plain" }),
      );

      const result = await safeFetch("https://example.com/robots.txt");
      expect(result.status).toBe(200);
      expect(result.bodyText).toBe("OK");
      expect(result.resolvedIp).toBe("93.184.216.34");
    });
  });
});
