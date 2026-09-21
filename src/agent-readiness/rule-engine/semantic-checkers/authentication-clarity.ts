// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiSpec } from "./helpers";

export const checkerAuthenticationClarity: SemanticChecker = (sources) => {
  const openapiSnap = sources.openapi;
  const guideSnap = sources.guide;
  const hasAnySource = openapiSnap || guideSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let schemePresent = false;
  let schemeDescribed = false;
  let credentialLocation = false;
  let howToObtain = false;

  // Check OpenAPI securitySchemes
  if (openapiSnap?.body) {
    const spec = parseJsonBody(openapiSnap) as OpenApiSpec | null;
    if (spec) {
      const components = (spec as unknown as Record<string, unknown>).components as Record<string, unknown> | undefined;
      const securitySchemes = components?.securitySchemes as Record<string, unknown> | undefined;
      if (securitySchemes && typeof securitySchemes === "object") {
        schemePresent = true;
        for (const scheme of Object.values(securitySchemes) as Array<Record<string, unknown>>) {
          if (scheme?.description && String(scheme.description).trim().length > 0) {
            schemeDescribed = true;
          }
          // Credential location: header name (Authorization), or in: query/header
          const schemeType = scheme?.type as string | undefined;
          if (schemeType === "http" || schemeType === "apiKey") {
            const headerName = scheme?.name as string | undefined;
            const schemeIn = scheme?.in as string | undefined;
            if (headerName || schemeIn) {
              credentialLocation = true;
            }
          }
          if (schemeType === "oauth2") {
            credentialLocation = true; // OAuth2 implies credentials in Authorization header
          }
        }
      }
    }
  }

  // Check guide for auth documentation
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("auth") || lower.includes("oauth") || lower.includes("api key") || lower.includes("bearer")) {
      if (!schemePresent) schemePresent = true; // guide documents auth even without OpenAPI
      // How to obtain credentials
      if (lower.includes("obtain") || lower.includes("register") || lower.includes("sign up") ||
        lower.includes("create") || lower.includes("request") || lower.includes("token endpoint") ||
        lower.includes("client_id") || lower.includes("api key")) {
        howToObtain = true;
      }
      // Credential location in guide
      if (lower.includes("authorization header") || lower.includes("bearer token") ||
        lower.includes("api key in") || lower.includes("x-api-key") || lower.includes("header")) {
        credentialLocation = true;
      }
    }
  }

  // Also check OpenAPI securityScheme descriptions for how-to-obtain
  if (openapiSnap?.body) {
    const spec = parseJsonBody(openapiSnap) as OpenApiSpec | null;
    if (spec) {
      const components = (spec as unknown as Record<string, unknown>).components as Record<string, unknown> | undefined;
      const securitySchemes = components?.securitySchemes as Record<string, unknown> | undefined;
      if (securitySchemes) {
        for (const scheme of Object.values(securitySchemes) as Array<Record<string, unknown>>) {
          const desc = scheme?.description as string | undefined;
          if (desc && (desc.toLowerCase().includes("obtain") || desc.toLowerCase().includes("register") ||
            desc.toLowerCase().includes("token endpoint") || desc.toLowerCase().includes("client_id"))) {
            howToObtain = true;
          }
        }
      }
    }
  }

  if (schemePresent && credentialLocation && howToObtain) {
    return { outcome: "found", detail: "Auth scheme, credential location, and how-to-obtain all evident" };
  }
  if (schemePresent && (credentialLocation || schemeDescribed)) {
    return { outcome: "partial", detail: "Auth scheme present but obtain/location incomplete" };
  }
  if (schemePresent) {
    return { outcome: "partial", detail: "Auth scheme present but no description or credential guidance" };
  }
  return { outcome: "absent", detail: "No authentication documentation found in any source" };
};

// ─── AB-154: Retry semantics declared ───────────────────────────────────────
