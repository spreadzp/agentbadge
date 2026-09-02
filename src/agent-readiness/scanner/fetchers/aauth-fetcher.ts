export interface AAuthScopeDescription {
  scope: string;
  description: string;
}

export interface AAuthResult {
  source: "aauth";
  data: {
    aauthFound: boolean;
    agentGrantSupported: boolean;
    scopeDescriptions: AAuthScopeDescription[];
    tokenEndpoint: string | null;
  };
}

type FetchFn = typeof fetch;

const AGENT_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:agent_authorization";

export async function fetchAAuth(
  baseUrl: string,
  fetchFn?: FetchFn,
): Promise<AAuthResult> {
  const _fetch = fetchFn ?? fetch;

  const data: AAuthResult["data"] = {
    aauthFound: false,
    agentGrantSupported: false,
    scopeDescriptions: [],
    tokenEndpoint: null,
  };

  // Probe /.well-known/aauth.json
  try {
    const aauthResp = await _fetch(`${baseUrl}/.well-known/aauth.json`);
    if (aauthResp.ok) {
      const aauthBody = await aauthResp.json();
      data.aauthFound = true;
      if (Array.isArray(aauthBody.scope_descriptions)) {
        data.scopeDescriptions = aauthBody.scope_descriptions
          .filter((s: unknown) => typeof s === "object" && s !== null)
          .map((s: Record<string, unknown>) => ({
            scope: String(s.scope ?? ""),
            description: String(s.description ?? ""),
          }));
      }
    }
  } catch {
    // network error or invalid JSON — aauthFound stays false
  }

  // Probe OAuth authorization server metadata for agent_authorization grant type
  try {
    const oauthResp = await _fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    if (oauthResp.ok) {
      const oauthBody = await oauthResp.json();
      if (oauthBody.token_endpoint) {
        data.tokenEndpoint = String(oauthBody.token_endpoint);
      }
      const grants = oauthBody.grant_types_supported;
      if (Array.isArray(grants) && grants.includes(AGENT_GRANT_TYPE)) {
        data.agentGrantSupported = true;
      }
    }
  } catch {
    // network error — agentGrantSupported stays false
  }

  return { source: "aauth", data };
}
