import { resolve4, resolve6 } from "node:dns/promises";
import { assertSafeIp } from "./ip-guard";
import { SsrfBlockedError, SsrfErrorCodes } from "./ssrf-error";

export interface PinnedResolve {
  ip: string;
  hostname: string;
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) || hostname.includes(":");
}

export async function resolveAndPin(hostname: string): Promise<PinnedResolve> {
  // If hostname is already an IP, skip DNS resolution
  if (isIpAddress(hostname)) {
    assertSafeIp(hostname);
    return { ip: hostname, hostname };
  }

  let v4s: string[] = [];
  let v6s: string[] = [];

  try {
    v4s = await resolve4(hostname);
  } catch {
    // no A records
  }

  try {
    v6s = await resolve6(hostname);
  } catch {
    // no AAAA records
  }

  const allIps = [...v4s, ...v6s];

  if (allIps.length === 0) {
    throw new SsrfBlockedError(hostname, undefined, SsrfErrorCodes.SSRF_DNS_RESOLVE_FAILED);
  }

  // Arc-audit C1 (EPIC-233-10): EVERY resolved A/AAAA must be safe —
  // a mixed answer ([127.0.0.1, 8.8.8.8]) used to pass on the first
  // public record, leaving the private one reachable at connect time.
  for (const ip of allIps) {
    try {
      assertSafeIp(ip);
    } catch {
      throw new SsrfBlockedError(hostname, `resolved-ip-blocked:${ip}`, SsrfErrorCodes.SSRF_DNS_ALL_BLOCKED);
    }
  }
  return { ip: allIps[0]!, hostname };
}
