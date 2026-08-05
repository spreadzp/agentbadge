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
  if (isIPv4(ip)) return isIPv4InBlockedRange(ip).blocked;
  if (isIPv6(ip)) return isIPv6Blocked(ip).blocked;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return isPrivateIp(ip);
}

export function assertSafeIp(ip: string): void {
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
