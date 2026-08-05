import { describe, it, expect, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { resolveAndPin } from "../src/agent-readiness/scanner/ssrf/dns-pin";
import { SsrfBlockedError, SsrfErrorCodes } from "../src/agent-readiness/scanner/ssrf/ssrf-error";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

describe("resolveAndPin", () => {
  it("returns first safe IP from A records", async () => {
    mockResolve4.mockResolvedValueOnce(["93.184.216.34"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));

    const result = await resolveAndPin("example.com");
    expect(result.ip).toBe("93.184.216.34");
    expect(result.hostname).toBe("example.com");
  });

  it("returns first safe IP from AAAA records when A is empty", async () => {
    mockResolve4.mockRejectedValueOnce(new Error("no A"));
    mockResolve6.mockResolvedValueOnce(["2606:4700:4700::1111"]);

    const result = await resolveAndPin("example.com");
    expect(result.ip).toBe("2606:4700:4700::1111");
  });

  it("throws SsrfBlockedError when all resolved IPs are blocked", async () => {
    mockResolve4.mockResolvedValueOnce(["127.0.0.1"]);
    mockResolve6.mockResolvedValueOnce(["::1"]);

    await expect(resolveAndPin("localhost")).rejects.toThrow(SsrfBlockedError);
  });

  it("throws with SSRF_DNS_ALL_BLOCKED code when all IPs blocked", async () => {
    mockResolve4.mockResolvedValueOnce(["10.0.0.1"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));

    try {
      await resolveAndPin("internal.example.com");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SsrfBlockedError);
      const err = e as SsrfBlockedError;
      expect(err.code).toBe(SsrfErrorCodes.SSRF_DNS_ALL_BLOCKED);
    }
  });

  it("throws with SSRF_DNS_RESOLVE_FAILED when no records found", async () => {
    mockResolve4.mockRejectedValueOnce(new Error("ENOTFOUND"));
    mockResolve6.mockRejectedValueOnce(new Error("ENOTFOUND"));

    try {
      await resolveAndPin("nonexistent.invalid");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SsrfBlockedError);
      const err = e as SsrfBlockedError;
      expect(err.code).toBe(SsrfErrorCodes.SSRF_DNS_RESOLVE_FAILED);
    }
  });

  it("skips blocked IPs and returns first safe one", async () => {
    mockResolve4.mockResolvedValueOnce(["10.0.0.1", "8.8.8.8"]);
    mockResolve6.mockRejectedValueOnce(new Error("no AAAA"));

    const result = await resolveAndPin("mixed.example.com");
    expect(result.ip).toBe("8.8.8.8");
  });
});
