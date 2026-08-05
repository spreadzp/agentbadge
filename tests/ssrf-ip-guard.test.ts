import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPrivateIp, isBlockedIp, assertSafeIp } from "../src/agent-readiness/scanner/ssrf/ip-guard";
import { SsrfBlockedError, SsrfErrorCodes } from "../src/agent-readiness/scanner/ssrf/ssrf-error";

describe("isPrivateIp — IPv4", () => {
  it("blocks RFC1918 10.0.0.0/8", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("blocks RFC1918 172.16.0.0/12", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
  });

  it("blocks RFC1918 192.168.0.0/16", () => {
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("192.168.0.0")).toBe(true);
  });

  it("blocks loopback 127.0.0.0/8", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("127.255.255.255")).toBe(true);
  });

  it("blocks link-local 169.254.0.0/16 (includes cloud metadata)", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("169.254.0.1")).toBe(true);
  });

  it("blocks 0.0.0.0/8 (current network)", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("0.255.255.255")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });
});

describe("isPrivateIp — IPv6", () => {
  it("blocks loopback ::1", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("blocks unique local fc00::/7", () => {
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
  });

  it("blocks link-local fe80::", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
  });

  it("blocks unspecified ::", () => {
    expect(isPrivateIp("::")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows public IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("isBlockedIp", () => {
  it("matches isPrivateIp for private IPs", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });
});

describe("assertSafeIp", () => {
  it("throws SsrfBlockedError for private IPs", () => {
    expect(() => assertSafeIp("10.0.0.1")).toThrow(SsrfBlockedError);
    expect(() => assertSafeIp("127.0.0.1")).toThrow(SsrfBlockedError);
    expect(() => assertSafeIp("169.254.169.254")).toThrow(SsrfBlockedError);
  });

  it("does not throw for public IPs", () => {
    expect(() => assertSafeIp("8.8.8.8")).not.toThrow();
  });

  it("error has correct code and details", () => {
    try {
      assertSafeIp("10.0.0.1");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SsrfBlockedError);
      const err = e as SsrfBlockedError;
      expect(err.code).toBe(SsrfErrorCodes.SSRF_BLOCKED);
      expect(err.details.ip).toBe("10.0.0.1");
      expect(err.details.range).toBe("rfc1918-10");
    }
  });
});

describe("SsrfBlockedError", () => {
  it("has stable code property", () => {
    const err = new SsrfBlockedError("10.0.0.1", "rfc1918-10");
    expect(err.code).toBe("SSRF_BLOCKED");
    expect(err.name).toBe("SsrfBlockedError");
    expect(err.details).toEqual({ ip: "10.0.0.1", range: "rfc1918-10" });
  });
});
