import type { ScannerRateLimiter } from "../rate-limiter";
import type { SnapshotCache } from "../cache";
import type { ResponseSnapshot } from "../snapshot";
import { simpleHandlers } from "./handlers-simple";
import { structuredHandlers } from "./handlers-structured";
import { contextHandlers } from "./handlers-context";
import type {
  AuthProbeContext,
  CredentialSecurityContext,
  EndpointProbeContext,
  FetchContext,
  OperationalDiscoveryContext,
  ResourceHandler,
} from "./types";

/** resource name → handler. Lookup miss → `null` snapshot (unknown resource). */
const RESOURCE_HANDLERS: Record<string, ResourceHandler> = {
  ...simpleHandlers,
  ...structuredHandlers,
  ...contextHandlers,
};

export async function fetchResource(
  resource: string,
  baseUrl: string,
  rateLimiter: ScannerRateLimiter,
  cache: SnapshotCache | null,
  authContext?: AuthProbeContext,
  endpointProbeContext?: EndpointProbeContext,
  operationalDiscoveryContext?: OperationalDiscoveryContext,
  credentialSecurityContext?: CredentialSecurityContext,
): Promise<ResponseSnapshot | null> {
  const cacheKey = `${baseUrl}/${resource}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const check = rateLimiter.checkDomain(new URL(baseUrl).hostname);
  if (!check.allowed) {
    await new Promise((r) => setTimeout(r, check.retryAfterMs));
  }
  rateLimiter.recordRequest(new URL(baseUrl).hostname);

  const handler = RESOURCE_HANDLERS[resource];
  const ctx: FetchContext = {
    baseUrl,
    auth: authContext,
    endpointProbe: endpointProbeContext,
    operationalDiscovery: operationalDiscoveryContext,
    credentialSecurity: credentialSecurityContext,
  };
  const snapshot = handler ? await handler(ctx) : null;

  if (snapshot && cache) {
    cache.set(cacheKey, snapshot);
  }

  return snapshot;
}
