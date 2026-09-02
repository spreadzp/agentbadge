export interface CredentialSecurityResult {
  source: "credential_security";
  data: {
    scopesDefined: boolean;
    revocationSupported: boolean;
    introspectionSupported: boolean;
    dpopSupported: boolean;
    mtlsBoundTokens: boolean;
    privateKeyJwtSupported: boolean;
    tokenExchangeSupported: boolean;
    usesOAuth2: boolean;
    usesStaticApiKey: boolean;
    credentialsInHeader: boolean;
    credentialsInQuery: boolean;
  };
}

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";

export function fetchCredentialSecurity(
  _baseUrl: string,
  oauthMetadataJson: string | null,
  openApiSpecJson: string | null,
): CredentialSecurityResult {
  const data: CredentialSecurityResult["data"] = {
    scopesDefined: false,
    revocationSupported: false,
    introspectionSupported: false,
    dpopSupported: false,
    mtlsBoundTokens: false,
    privateKeyJwtSupported: false,
    tokenExchangeSupported: false,
    usesOAuth2: false,
    usesStaticApiKey: false,
    credentialsInHeader: false,
    credentialsInQuery: false,
  };

  // Parse OAuth metadata
  if (oauthMetadataJson) {
    try {
      const meta = JSON.parse(oauthMetadataJson);

      if (Array.isArray(meta.scopes_supported) && meta.scopes_supported.length > 0) {
        data.scopesDefined = true;
      }

      if (meta.revocation_endpoint) {
        data.revocationSupported = true;
      }

      if (meta.introspection_endpoint) {
        data.introspectionSupported = true;
      }

      if (Array.isArray(meta.dpop_signing_alg_values_supported) && meta.dpop_signing_alg_values_supported.length > 0) {
        data.dpopSupported = true;
      }

      if (meta.tls_client_certificate_bound_access_tokens === true) {
        data.mtlsBoundTokens = true;
      }

      const authMethods = meta.token_endpoint_auth_methods_supported;
      if (Array.isArray(authMethods) && authMethods.includes("private_key_jwt")) {
        data.privateKeyJwtSupported = true;
      }

      const grants = meta.grant_types_supported;
      if (Array.isArray(grants) && grants.includes(TOKEN_EXCHANGE_GRANT)) {
        data.tokenExchangeSupported = true;
      }
    } catch {
      // invalid JSON — all fields stay false
    }
  }

  // Parse OpenAPI security schemes
  if (openApiSpecJson) {
    try {
      const spec = JSON.parse(openApiSpecJson);
      const schemes = spec?.components?.securitySchemes;
      if (schemes && typeof schemes === "object") {
        for (const scheme of Object.values(schemes) as Record<string, unknown>[]) {
          const type = scheme.type;
          if (type === "oauth2") {
            data.usesOAuth2 = true;
            data.credentialsInHeader = true;
          }
          if (type === "apiKey") {
            data.usesStaticApiKey = true;
            const inLocation = scheme.in;
            if (inLocation === "header") {
              data.credentialsInHeader = true;
            }
            if (inLocation === "query") {
              data.credentialsInQuery = true;
            }
          }
        }
      }
    } catch {
      // invalid JSON — all fields stay false
    }
  }

  return { source: "credential_security", data };
}
