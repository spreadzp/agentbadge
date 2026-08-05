import { resolve4, resolve6 } from "node:dns/promises";
import { assertSafeIp } from "./ip-guard";
import { SsrfBlockedError, SsrfErrorCodes } from "./ssrf-error";

export interface PinnedResolve {
  ip: string;
  hostname: string;
}

export async function resolveAndPin(hostname: string): Promise<PinnedResolve> {
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

  for (const ip of allIps) {
    try {
      assertSafeIp(ip);
      return { ip, hostname };
    } catch {
      // try next IP
    }
  }

  throw new SsrfBlockedError(hostname, "all-resolved-ips-blocked", SsrfErrorCodes.SSRF_DNS_ALL_BLOCKED);
}
