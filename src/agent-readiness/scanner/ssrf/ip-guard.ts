import { SsrfBlockedError } from "./ssrf-error";
import {
  expandIpv6ToHextets,
  hextetsToV4,
  unbracketV6,
} from "./ip-guard-v6";

const BLOCKED_RANGES_V4: readonly { cidr: string; label: string }[] = [
  { cidr: "0.0.0.0/8", label: "current-network" },
  { cidr: "10.0.0.0/8", label: "rfc1918-10" },
  { cidr: "127.0.0.0/8", label: "loopback" },
  { cidr: "169.254.0.0/16", label: "link-local" },
  { cidr: "172.16.0.0/12", label: "rfc1918-172" },
  { cidr: "192.168.0.0/16", label: "rfc1918-192" },
  { cidr: "100.64.0.0/10", label: "carrier-grade-nat" },
  { cidr: "192.0.2.0/24", label: "documentation-192" },
  { cidr: "198.51.100.0/24", label: "documentation-198" },
  { cidr: "203.0.113.0/24", label: "documentation-203" },
  // SLICE-259-38 (DeepSeek ds9): reserved-but-nonprivate ranges that hosted
  // provider metadata endpoints hide behind — 192.0.0.192 is Oracle Cloud
  // metadata, 240/4 is IANA-reserved, 198.18/15 is RFC2544 benchmarking.
  { cidr: "192.0.0.0/24", label: "ietf-protocol-assignments" },
  { cidr: "192.88.99.0/24", label: "6to4-relay" },
  { cidr: "198.18.0.0/15", label: "benchmarking" },
  { cidr: "240.0.0.0/4", label: "reserved-240" },
  // SLICE-259-39 (DeepSeek ds13): multicast is not a scannable target —
  // it fell through to a connect-hang/500 instead of a clean 403.
  { cidr: "224.0.0.0/4", label: "multicast" },
];

const METADATA_IPS: readonly string[] = [
  "169.254.169.254",
  "fd00:ec2::254",
];

function ipV4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255 || Number.isNaN(p))) {
    throw new Error(`Invalid IPv4: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrV4ToRange(cidr: string): { start: number; end: number } {
  const [ip, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const ipInt = ipV4ToInt(ip);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const start = (ipInt & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { start, end };
}

function parseIPv4MappedV6(ip: string): string | null {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) return m[1];
  // SLICE-259-37: hex-compressed mapped form — ::ffff:7f00:1 is ::ffff:127.0.0.1
  const hex = ip.match(/^::ffff:0*([0-9a-f]{1,4}):0*([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isIPv4(ip: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

function isIPv6(ip: string): boolean {
  return ip.includes(":");
}

function isIPv4InBlockedRange(ip: string): { blocked: boolean; range?: string } {
  const ipInt = ipV4ToInt(ip);
  for (const { cidr, label } of BLOCKED_RANGES_V4) {
    const { start, end } = cidrV4ToRange(cidr);
    if (ipInt >= start && ipInt <= end) {
      return { blocked: true, range: label };
    }
  }
  for (const meta of METADATA_IPS) {
    if (ip === meta) return { blocked: true, range: "cloud-metadata" };
  }
  return { blocked: false };
}

function isIPv6Blocked(ip: string): { blocked: boolean; range?: string } {
  const hx = expandIpv6ToHextets(ip);
  if (!hx) {
    // Re-verify N6 (233-10): fail CLOSED on malformed v6 (zone ids,
    // truncated literals) — upstream parsers may not always reject.
    const mapped = parseIPv4MappedV6(ip);
    if (mapped) return isIPv4InBlockedRange(mapped);
    return { blocked: true, range: "malformed-v6" };
  }
  const [h0, h1] = hx;

  // IPv4-mapped ::ffff:0:0/96 in ANY textual form (compressed or
  // spelled out) — extract and re-check the embedded IPv4.
  if (hx.slice(0, 5).every((h) => h === 0) && hx[5] === 0xffff) {
    const inner = isIPv4InBlockedRange(hextetsToV4(hx[6], hx[7]));
    return inner.blocked ? inner : { blocked: false };
  }

  // Arc-audit H2 (EPIC-233-10): transition/encapsulation encodings that
  // smuggle IPv4 past the guard — extract + re-check the embedded v4.
  // IPv4-compatible ::/96 (deprecated, but still parses as a literal).
  if (hx.slice(0, 6).every((h) => h === 0)) {
    if (hx[7] === 0) return { blocked: true, range: "unspecified" };
    if (hx[7] === 1) return { blocked: true, range: "loopback-v6" };
    const inner = isIPv4InBlockedRange(hextetsToV4(hx[6], hx[7]));
    return inner.blocked
      ? inner
      : { blocked: true, range: "v4-compatible" };
  }
  // IPv4-translated ::ffff:0:0/96 (SIIT) — same extraction as mapped.
  if (hx.slice(0, 4).every((h) => h === 0) && hx[4] === 0xffff) {
    const inner = isIPv4InBlockedRange(hextetsToV4(hx[6], hx[7]));
    return inner.blocked ? inner : { blocked: true, range: "v4-translated" };
  }
  // NAT64 well-known 64:ff9b::/96 + local-use 64:ff9b:1::/48 — v4 target.
  if (h0 === 0x0064 && h1 === 0xff9b && (hx[2] === 0 || hx[2] === 0x0001)) {
    const inner = isIPv4InBlockedRange(hextetsToV4(hx[6], hx[7]));
    return inner.blocked ? inner : { blocked: true, range: "nat64" };
  }
  // Re-verify N6 (233-10): Teredo 2001::/32 tunnels to v4; doc range
  // 2001:db8::/32 is non-routable.
  if (h0 === 0x2001 && (h1 === 0x0000 || h1 === 0x0db8)) {
    return { blocked: true, range: h1 === 0 ? "teredo" : "documentation-v6" };
  }
  // 6to4 2002::/16 — embedded v4 lives in hextets 1-2.
  if (h0 === 0x2002) {
    const inner = isIPv4InBlockedRange(hextetsToV4(hx[1], hx[2]));
    return inner.blocked ? inner : { blocked: true, range: "6to4" };
  }

  if ((h0 & 0xfe00) === 0xfc00) return { blocked: true, range: "ula-v6" };
  if ((h0 & 0xffc0) === 0xfe80) return { blocked: true, range: "link-local-v6" };
  if ((h0 & 0xffc0) === 0xfec0) return { blocked: true, range: "site-local-v6" };
  if ((h0 & 0xff00) === 0xff00) return { blocked: true, range: "multicast-v6" };

  return { blocked: false };
}

// SLICE-259-37 / 233-10 split: v6 expansion helpers live in
// ip-guard-v6.ts (expandIpv6ToHextets, hextetsToV4, unbracketV6).

export function isPrivateIp(ip: string): boolean {
  // Re-verify N2 (233-10): the kill-switch is dev-only — in production
  // a stray AGENTBADGE_ALLOW_PRIVATE_IPS must not silently disable the
  // whole SSRF guard.
  if (
    process.env.NODE_ENV !== "production" &&
    (process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "1" || process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "true")
  ) {
    return false;
  }
  const normalized = unbracketV6(ip);
  if (isIPv4(normalized)) return isIPv4InBlockedRange(normalized).blocked;
  if (isIPv6(normalized)) return isIPv6Blocked(normalized).blocked;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return isPrivateIp(ip);
}

/**
 * Canonical hostname-level SSRF guard.
 * Resolves hostname to IP, then validates via assertSafeIp.
 * Use this at API entry points instead of ad-hoc string blocklists.
 */
// Well-known local-name suffixes that resolve to loopback/link-local.
// Hostnames like `localhost` never reach resolveAndPin in tests and are a
// trivial private-target alias in prod — reject at the entry point.
const LOCAL_NAME_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".intranet",
];

export function assertSafeTarget(hostname: string): void {
  // Re-verify N7 (233-10): strip a trailing dot — `localhost.` used to
  // slip past the suffix check; DNS treats it as equivalent.
  const lower = hostname.toLowerCase().replace(/\.+$/, "");
  for (const suffix of LOCAL_NAME_SUFFIXES) {
    if (suffix === "localhost" ? lower === suffix : lower.endsWith(suffix)) {
      throw new Error(`Blocked local hostname: ${hostname}`);
    }
  }

  // If it's already an IP, validate directly
  if (isIPv4(hostname) || isIPv6(hostname)) {
    assertSafeIp(hostname);
    return;
  }

  // For hostnames, the orchestrator's resolveAndPin will validate.
  // This function is a synchronous pre-check for obvious cases.
  // Hex/octal encoded IPs are caught by isIPv4 if they match the pattern,
  // but decimal-encoded (e.g. 2130706433) need special handling.
  // N7: only ALL-DIGIT strings are decimal IPs — parseInt("1password.com")
  // is 1, which used to false-positive-block legit digit-leading hosts.
  if (/^\d+$/.test(hostname)) {
    const decimal = parseInt(hostname, 10);
    if (!Number.isNaN(decimal) && decimal > 0) {
      // Convert decimal IP to dotted notation
      const a = (decimal >>> 24) & 0xff;
      const b = (decimal >>> 16) & 0xff;
      const c = (decimal >>> 8) & 0xff;
      const d = decimal & 0xff;
      const dotted = `${a}.${b}.${c}.${d}`;
      if (dotted !== hostname) {
        assertSafeIp(dotted);
        return;
      }
    }
  }

  // Octal: 0177.0.0.1 — parse each octet
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split(".");
    const dotted = parts
      .map((p) => {
        if (p.startsWith("0") && p.length > 1) {
          return parseInt(p, 8).toString();
        }
        return p;
      })
      .join(".");
    if (dotted !== hostname) {
      assertSafeIp(dotted);
      return;
    }
  }
}

export function assertSafeIp(ip: string): void {
  if (process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "1" || process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "true") {
    return;
  }
  const normalized = unbracketV6(ip);
  if (isIPv4(normalized)) {
    const result = isIPv4InBlockedRange(normalized);
    if (result.blocked) throw new SsrfBlockedError(normalized, result.range);
    return;
  }
  if (isIPv6(normalized)) {
    const result = isIPv6Blocked(normalized);
    if (result.blocked) throw new SsrfBlockedError(normalized, result.range);
    return;
  }
  throw new SsrfBlockedError(ip, "unparseable");
}
