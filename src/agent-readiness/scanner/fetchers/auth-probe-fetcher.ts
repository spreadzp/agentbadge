import type { ResponseSnapshot } from "../snapshot";

export interface AuthProbeCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AuthProbeResult {
  status: "success" | "not_supported" | "credentials_required" | "token_error" | "endpoint_error" | "no_oauth_metadata";
  tokenObtained: boolean;
  tokenEndpoint?: string;
  endpointStatus?: number;
  grantType?: string;
  tokenExpiresIn?: number;
  error?: string;
}

export async function fetchAuthProbe(
  baseUrl: string,
  oauthSnapshot: ResponseSnapshot | null,
  credentials?: AuthProbeCredentials,
  fetchFn?: typeof fetch,
): Promise<AuthProbeResult> {
  if (!oauthSnapshot || !oauthSnapshot.body) {
    return { status: "no_oauth_metadata", tokenObtained: false };
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(oauthSnapshot.body);
  } catch {
    return { status: "no_oauth_metadata", tokenObtained: false };
  }

  const tokenEndpoint = metadata.token_endpoint as string | undefined;
  if (!tokenEndpoint) {
    return { status: "no_oauth_metadata", tokenObtained: false };
  }

  const grants = (metadata.grant_types_supported as string[]) ?? [];
  if (!grants.includes("client_credentials")) {
    return { status: "not_supported", tokenObtained: false, tokenEndpoint };
  }

  if (!credentials?.clientId || !credentials?.clientSecret) {
    return { status: "credentials_required", tokenObtained: false, tokenEndpoint };
  }

  const _fetch = fetchFn ?? fetch;

  // Step 1: Request token
  let tokenResp: Response;
  try {
    tokenResp = await _fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(credentials.clientId)}&client_secret=${encodeURIComponent(credentials.clientSecret)}`,
    });
  } catch (e) {
    return { status: "token_error", tokenObtained: false, tokenEndpoint, error: `network: ${(e as Error).message}` };
  }

  if (!tokenResp.ok) {
    return { status: "token_error", tokenObtained: false, tokenEndpoint, error: `HTTP ${tokenResp.status}` };
  }

  let tokenBody: Record<string, unknown>;
  try {
    tokenBody = await tokenResp.json();
  } catch {
    return { status: "token_error", tokenObtained: false, tokenEndpoint, error: "invalid JSON response" };
  }

  const accessToken = tokenBody.access_token as string | undefined;
  if (!accessToken) {
    return { status: "token_error", tokenObtained: false, tokenEndpoint, error: "no access_token in response" };
  }

  // Step 2: Call a protected endpoint
  const probeUrl = `${baseUrl}/`;
  let probeResp: Response;
  try {
    probeResp = await _fetch(probeUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    return { status: "endpoint_error", tokenObtained: true, tokenEndpoint, tokenExpiresIn: typeof tokenBody.expires_in === "number" ? tokenBody.expires_in : undefined, error: `network: ${(e as Error).message}` };
  }

  if (probeResp.ok) {
    return { status: "success", tokenObtained: true, tokenEndpoint, endpointStatus: probeResp.status, grantType: "client_credentials", tokenExpiresIn: typeof tokenBody.expires_in === "number" ? tokenBody.expires_in : undefined };
  }

  return {
    status: "endpoint_error",
    tokenObtained: true,
    tokenEndpoint,
    endpointStatus: probeResp.status,
    grantType: "client_credentials",
    tokenExpiresIn: typeof tokenBody.expires_in === "number" ? tokenBody.expires_in : undefined,
    error: `Endpoint returned ${probeResp.status}`,
  };
}
