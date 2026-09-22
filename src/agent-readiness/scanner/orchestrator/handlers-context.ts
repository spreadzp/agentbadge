import { fetchAuthProbe } from "../fetchers/auth-probe-fetcher";
import { fetchEndpointProbe } from "../fetchers/endpoint-probe-fetcher";
import { fetchOperationalDiscovery } from "../fetchers/operational-discovery-fetcher";
import { fetchCredentialSecurity } from "../fetchers/credential-security-fetcher";
import { snapJson } from "./snapshots";
import type { ResourceHandler } from "./types";

/**
 * Context-dependent handlers: these need snapshots/credentials gathered from
 * earlier resources, supplied via `FetchContext`.
 */
export const contextHandlers: Record<string, ResourceHandler> = {
  auth_probe: async ({ baseUrl, auth }) => {
    if (!auth) return null;
    const result = await fetchAuthProbe(baseUrl, auth.oauthSnapshot, auth.credentials);
    return snapJson(`${baseUrl}/auth-probe`, result);
  },
  endpoint_probe: async ({ baseUrl, endpointProbe }) => {
    if (!endpointProbe) return null;
    const result = await fetchEndpointProbe(
      baseUrl,
      endpointProbe.openapiSnapshot,
      { maxEndpoints: endpointProbe.maxEndpoints },
    );
    return snapJson(`${baseUrl}/endpoint-probe`, result);
  },
  operational_discovery: async ({ baseUrl, operationalDiscovery }) => {
    const homepageSnap = operationalDiscovery?.homepageSnapshot ?? null;
    const result = await fetchOperationalDiscovery(baseUrl, homepageSnap);
    return snapJson(`${baseUrl}/operational-discovery`, result);
  },
  credential_security: async ({ baseUrl, credentialSecurity }) => {
    const oauthBody = credentialSecurity?.oauthBody ?? null;
    const openapiBody = credentialSecurity?.openapiBody ?? null;
    const result = fetchCredentialSecurity(baseUrl, oauthBody, openapiBody);
    return snapJson(`${baseUrl}/credential-security`, result);
  },
};
