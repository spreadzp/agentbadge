import { SsrfBlockedError } from "./ssrf-error";

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

/** Expand any IPv6 textual form (compressed `::`, dotted-quad tail,
 *  mixed case) into 8 hextets; null on malformed input. Needed for
 *  prefix checks — literal-regex matching misses compressed forms
 *  (`fd::1` vs `fd00::`, `0:0:0:0:0:ffff:7f00:1` vs `::ffff:127.0.0.1`). */
function expandIpv6ToHextets(ip: string): number[] | null {
  const normalized = unbracketV6(ip).toLowerCase();
  let head = normalized;
  const v4Tail: number[] = [];
  const dotMatch = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotMatch) {
    const octs = dotMatch[1].split(".").map(Number);
    if (octs.some((o) => o > 255)) return null;
    v4Tail.push((octs[0] << 8) | octs[1], (octs[2] << 8) | octs[3]);
    head = normalized.slice(0, dotMatch.index);
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter((s) => s.length) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter((s) => s.length) : [];
  const hexRe = /^[0-9a-f]{1,4}$/;
  if (![...left, ...right].every((h) => hexRe.test(h))) return null;
  if (halves.length === 1) {
    if (left.length + v4Tail.length !== 8) return null;
    return [...left.map((h) => parseInt(h, 16)), ...v4Tail];
  }
  const missing = 8 - left.length - right.length - v4Tail.length;
  if (missing < 0) return null;
  return [
    ...left.map((h) => parseInt(h, 16)),
    ...new Array<number>(missing).fill(0),
    ...right.map((h) => parseInt(h, 16)),
    ...v4Tail,
  ];
}

function hextetsToV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isIPv6Blocked(ip: string): { blocked: boolean; range?: string } {
  const hx = expandIpv6ToHextets(ip);
  if (!hx) {
    // Malformed literal — URL parsing rejects most of these upstream;
    // keep the legacy mapped-v4 fast path as a last-resort check.
    const mapped = parseIPv4MappedV6(ip);
    if (mapped) return isIPv4InBlockedRange(mapped);
    return { blocked: false };
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
  // NAT64 well-known prefix 64:ff9b::/96 — synthesized v4 target.
  if (h0 === 0x0064 && h1 === 0xff9b && hx[2] === 0 && hx[3] === 0 && hx[4] === 0) {
    const inner = isIPv4InBlockedRange(hextetsToV4(hx[6], hx[7]));
    return inner.blocked ? inner : { blocked: true, range: "nat64" };
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

// SLICE-259-37: WHATWG URL keeps brackets on IPv6 hostnames
// (new URL("http://[::1]/").hostname === "[::1]") — normalize before
// range checks or every bracketed literal bypasses the guard.
function unbracketV6(ip: string): string {
  return ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
}

export function isPrivateIp(ip: string): boolean {
  if (process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "1" || process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "true") {
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
  const lower = hostname.toLowerCase();
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
