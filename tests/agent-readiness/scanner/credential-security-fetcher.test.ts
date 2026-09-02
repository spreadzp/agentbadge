import { describe, it, expect } from "vitest";
import { fetchCredentialSecurity } from "../../../src/agent-readiness/scanner/fetchers/credential-security-fetcher";

describe("credential-security-fetcher", () => {
  it("analyzes OAuth metadata for security features", () => {
    const oauthMetadata = JSON.stringify({
      scopes_supported: ["read", "write"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "private_key_jwt", "tls_client_auth"],
      revocation_endpoint: "https://auth.example.com/revoke",
      introspection_endpoint: "https://auth.example.com/introspect",
      dpop_signing_alg_values_supported: ["ES256", "RS256"],
      tls_client_certificate_bound_access_tokens: true,
    });
    const result = fetchCredentialSecurity("https://example.com", oauthMetadata, null);
    expect(result.source).toBe("credential_security");
    expect(result.data.scopesDefined).toBe(true);
    expect(result.data.revocationSupported).toBe(true);
    expect(result.data.introspectionSupported).toBe(true);
    expect(result.data.dpopSupported).toBe(true);
    expect(result.data.mtlsBoundTokens).toBe(true);
    expect(result.data.privateKeyJwtSupported).toBe(true);
  });

  it("analyzes OpenAPI security schemes for OAuth2", () => {
    const openapiSpec = JSON.stringify({
      openapi: "3.1.0",
      components: {
        securitySchemes: {
          OAuth2: {
            type: "oauth2",
            flows: {
              clientCredentials: {
                tokenUrl: "/token",
                scopes: { read: "Read access" },
              },
            },
          },
        },
      },
    });
    const result = fetchCredentialSecurity("https://example.com", null, openapiSpec);
    expect(result.data.usesOAuth2).toBe(true);
    expect(result.data.usesStaticApiKey).toBe(false);
    expect(result.data.credentialsInHeader).toBe(true);
    expect(result.data.credentialsInQuery).toBe(false);
  });

  it("detects static API key in query params (bad practice)", () => {
    const openapiSpec = JSON.stringify({
      openapi: "3.1.0",
      components: {
        securitySchemes: {
          ApiKey: {
            type: "apiKey",
            in: "query",
            name: "api_key",
          },
        },
      },
    });
    const result = fetchCredentialSecurity("https://example.com", null, openapiSpec);
    expect(result.data.usesStaticApiKey).toBe(true);
    expect(result.data.credentialsInQuery).toBe(true);
    expect(result.data.usesOAuth2).toBe(false);
  });

  it("detects API key in header (better than query but still static)", () => {
    const openapiSpec = JSON.stringify({
      openapi: "3.1.0",
      components: {
        securitySchemes: {
          ApiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
          },
        },
      },
    });
    const result = fetchCredentialSecurity("https://example.com", null, openapiSpec);
    expect(result.data.usesStaticApiKey).toBe(true);
    expect(result.data.credentialsInHeader).toBe(true);
    expect(result.data.credentialsInQuery).toBe(false);
    expect(result.data.usesOAuth2).toBe(false);
  });

  it("handles both OAuth metadata and OpenAPI spec", () => {
    const oauthMetadata = JSON.stringify({
      scopes_supported: ["read"],
      revocation_endpoint: "https://auth.example.com/revoke",
    });
    const openapiSpec = JSON.stringify({
      openapi: "3.1.0",
      components: {
        securitySchemes: {
          OAuth2: {
            type: "oauth2",
            flows: {
              clientCredentials: { tokenUrl: "/token", scopes: { read: "Read" } },
            },
          },
        },
      },
    });
    const result = fetchCredentialSecurity("https://example.com", oauthMetadata, openapiSpec);
    expect(result.data.scopesDefined).toBe(true);
    expect(result.data.revocationSupported).toBe(true);
    expect(result.data.usesOAuth2).toBe(true);
    expect(result.data.usesStaticApiKey).toBe(false);
  });

  it("handles null inputs gracefully", () => {
    const result = fetchCredentialSecurity("https://example.com", null, null);
    expect(result.source).toBe("credential_security");
    expect(result.data.scopesDefined).toBe(false);
    expect(result.data.revocationSupported).toBe(false);
    expect(result.data.usesOAuth2).toBe(false);
    expect(result.data.usesStaticApiKey).toBe(false);
    expect(result.data.credentialsInHeader).toBe(false);
    expect(result.data.credentialsInQuery).toBe(false);
  });

  it("handles invalid JSON gracefully", () => {
    const result = fetchCredentialSecurity("https://example.com", "not json", "also not json");
    expect(result.data.scopesDefined).toBe(false);
    expect(result.data.usesOAuth2).toBe(false);
  });

  it("detects token exchange support (RFC 8693)", () => {
    const oauthMetadata = JSON.stringify({
      grant_types_supported: [
        "client_credentials",
        "urn:ietf:params:oauth:grant-type:token-exchange",
      ],
    });
    const result = fetchCredentialSecurity("https://example.com", oauthMetadata, null);
    expect(result.data.tokenExchangeSupported).toBe(true);
  });

  it("detects multiple security schemes including both oauth2 and apiKey", () => {
    const openapiSpec = JSON.stringify({
      openapi: "3.1.0",
      components: {
        securitySchemes: {
          OAuth2: {
            type: "oauth2",
            flows: { clientCredentials: { tokenUrl: "/token", scopes: {} } },
          },
          ApiKey: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
          },
        },
      },
    });
    const result = fetchCredentialSecurity("https://example.com", null, openapiSpec);
    expect(result.data.usesOAuth2).toBe(true);
    expect(result.data.usesStaticApiKey).toBe(true);
    expect(result.data.credentialsInHeader).toBe(true);
  });

  it("handles empty scopes_supported array", () => {
    const oauthMetadata = JSON.stringify({
      scopes_supported: [],
    });
    const result = fetchCredentialSecurity("https://example.com", oauthMetadata, null);
    expect(result.data.scopesDefined).toBe(false);
  });

  it("handles missing scopes_supported field", () => {
    const oauthMetadata = JSON.stringify({
      revocation_endpoint: "https://auth.example.com/revoke",
    });
    const result = fetchCredentialSecurity("https://example.com", oauthMetadata, null);
    expect(result.data.scopesDefined).toBe(false);
    expect(result.data.revocationSupported).toBe(true);
  });
});
