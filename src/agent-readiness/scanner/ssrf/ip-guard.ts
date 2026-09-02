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
  return m ? m[1] : null;
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
  const mapped = parseIPv4MappedV6(ip);
  if (mapped) return isIPv4InBlockedRange(mapped);

  if (ip === "::1") return { blocked: true, range: "loopback-v6" };
  if (/^fc[0-9a-f]{2}:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip)) {
    return { blocked: true, range: "ula-v6" };
  }
  if (/^fe80:/i.test(ip)) return { blocked: true, range: "link-local-v6" };
  if (ip === "::" || ip === "::ffff:0.0.0.0") return { blocked: true, range: "unspecified" };

  return { blocked: false };
}

export function isPrivateIp(ip: string): boolean {
  if (process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "1" || process.env.AGENTBADGE_ALLOW_PRIVATE_IPS === "true") {
    return false;
  }
  if (isIPv4(ip)) return isIPv4InBlockedRange(ip).blocked;
  if (isIPv6(ip)) return isIPv6Blocked(ip).blocked;
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
export function assertSafeTarget(hostname: string): void {
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
  if (isIPv4(ip)) {
    const result = isIPv4InBlockedRange(ip);
    if (result.blocked) throw new SsrfBlockedError(ip, result.range);
    return;
  }
  if (isIPv6(ip)) {
    const result = isIPv6Blocked(ip);
    if (result.blocked) throw new SsrfBlockedError(ip, result.range);
    return;
  }
  throw new SsrfBlockedError(ip, "unparseable");
}
