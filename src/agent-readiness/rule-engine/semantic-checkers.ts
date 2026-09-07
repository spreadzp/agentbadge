import type { ResponseSnapshot } from "../scanner/snapshot";

export type Snapshots = Record<string, ResponseSnapshot | null>;

export interface SemanticCheckResult {
  outcome: "found" | "partial" | "absent" | "no_source";
  detail: string;
}

export type SemanticChecker = (sources: Snapshots) => SemanticCheckResult;

export function parseJsonBody(snapshot: ResponseSnapshot): unknown | null {
  if (!snapshot.body) return null;
  try {
    return JSON.parse(snapshot.body);
  } catch {
    return null;
  }
}

interface OpenApiMediaType {
  example?: unknown;
  examples?: Record<string, unknown>;
  schema?: unknown;
}

interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

interface OpenApiOperation {
  description?: string;
  parameters?: Array<{
    name?: string;
    in?: string;
    description?: string;
    required?: boolean;
    schema?: unknown;
  }>;
  requestBody?: {
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, OpenApiResponse>;
}

interface OpenApiPathItem {
  [method: string]: OpenApiOperation | string | unknown;
}

interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options", "trace"];

function isHttpMethod(key: string): boolean {
  return HTTP_METHODS.includes(key.toLowerCase());
}

function getOperations(spec: OpenApiSpec): Array<{ path: string; method: string; op: OpenApiOperation }> {
  const operations: Array<{ path: string; method: string; op: OpenApiOperation }> = [];
  if (!spec.paths) return operations;
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (typeof pathItem !== "object" || pathItem === null) continue;
    for (const [method, op] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;
      if (typeof op === "object" && op !== null) {
        operations.push({ path, method: method.toUpperCase(), op: op as OpenApiOperation });
      }
    }
  }
  return operations;
}

const checkerOpenapiOperationDescriptions: SemanticChecker = (sources) => {
  const snap = sources.openapi;
  if (!snap) return { outcome: "no_source", detail: "OpenAPI snapshot not found" };

  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return { outcome: "no_source", detail: "OpenAPI body could not be parsed as JSON" };

  const operations = getOperations(spec);
  if (operations.length === 0) {
    return { outcome: "absent", detail: "No operations found in OpenAPI spec" };
  }

  const withDesc = operations.filter((o) => o.op.description && o.op.description.trim().length > 0);
  if (withDesc.length === operations.length) {
    return { outcome: "found", detail: `All ${operations.length} operations have descriptions` };
  }
  if (withDesc.length > 0) {
    return {
      outcome: "partial",
      detail: `${withDesc.length} of ${operations.length} operations have descriptions`,
    };
  }
  return {
    outcome: "absent",
    detail: `All ${operations.length} operations are missing descriptions`,
  };
};

const checkerOpenapiParameterSemantics: SemanticChecker = (sources) => {
  const snap = sources.openapi;
  if (!snap) return { outcome: "no_source", detail: "OpenAPI snapshot not found" };

  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return { outcome: "no_source", detail: "OpenAPI body could not be parsed as JSON" };

  const operations = getOperations(spec);
  if (operations.length === 0) {
    return { outcome: "absent", detail: "No operations found in OpenAPI spec" };
  }

  const allParams: Array<{ op: string; param: NonNullable<OpenApiOperation["parameters"]>[number] }> = [];
  for (const op of operations) {
    if (op.op.parameters) {
      for (const param of op.op.parameters) {
        allParams.push({ op: `${op.method} ${op.path}`, param });
      }
    }
  }

  if (allParams.length === 0) {
    return { outcome: "absent", detail: "No parameters found across any operation" };
  }

  const withDesc = allParams.filter(
    (p) => p.param.description && p.param.description.trim().length > 0,
  );
  if (withDesc.length === allParams.length) {
    return { outcome: "found", detail: `All ${allParams.length} parameters have descriptions` };
  }
  if (withDesc.length > 0) {
    return {
      outcome: "partial",
      detail: `${withDesc.length} of ${allParams.length} parameters have descriptions`,
    };
  }
  return {
    outcome: "absent",
    detail: `All ${allParams.length} parameters are missing descriptions`,
  };
};

const checkerOpenapiExamples: SemanticChecker = (sources) => {
  const snap = sources.openapi;
  if (!snap) return { outcome: "no_source", detail: "OpenAPI snapshot not found" };

  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return { outcome: "no_source", detail: "OpenAPI body could not be parsed as JSON" };

  const operations = getOperations(spec);
  if (operations.length === 0) {
    return { outcome: "absent", detail: "No operations found in OpenAPI spec" };
  }

  let requestExamples = 0;
  let responseExamples = 0;
  let schemaExamples = 0;

  for (const { op } of operations) {
    if (op.requestBody?.content) {
      for (const mediaType of Object.values(op.requestBody.content)) {
        if (mediaType?.example || mediaType?.examples) {
          requestExamples++;
          break;
        }
      }
    }
    if (op.responses) {
      for (const resp of Object.values(op.responses)) {
        if (resp?.content) {
          for (const mediaType of Object.values(resp.content)) {
            if (mediaType?.example || mediaType?.examples) {
              responseExamples++;
              break;
            }
          }
        }
      }
    }
  }

  const components = (spec as unknown as { components?: { schemas?: Record<string, unknown> } }).components;
  if (components?.schemas) {
    for (const schema of Object.values(components.schemas) as Array<Record<string, unknown>>) {
      if (schema?.example || schema?.properties) {
        const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
        const hasPropExample = Object.values(props).some((p) => p?.example);
        if (schema.example || hasPropExample) {
          schemaExamples++;
        }
      }
    }
  }

  if (requestExamples > 0 && responseExamples > 0) {
    return { outcome: "found", detail: `Examples for ${requestExamples} request(s) and ${responseExamples} response(s)` };
  }
  if (schemaExamples > 0 || requestExamples > 0 || responseExamples > 0) {
    return { outcome: "partial", detail: `Partial examples: ${requestExamples} request, ${responseExamples} response, ${schemaExamples} schema` };
  }
  return { outcome: "absent", detail: "No examples found in operations or schemas" };
};

const checkerOpenapiErrorSchemas: SemanticChecker = (sources) => {
  const snap = sources.openapi;
  if (!snap) return { outcome: "no_source", detail: "OpenAPI snapshot not found" };

  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return { outcome: "no_source", detail: "OpenAPI body could not be parsed as JSON" };

  const operations = getOperations(spec);
  if (operations.length === 0) {
    return { outcome: "absent", detail: "No operations found in OpenAPI spec" };
  }

  let opsWithErrorSchemas = 0;
  let opsWith4xx = 0;
  let hasProblemJson = false;

  for (const { op } of operations) {
    if (!op.responses) continue;

    const errorCodes = Object.keys(op.responses).filter(
      (code) => code.startsWith("4") || code.startsWith("5"),
    );
    if (errorCodes.length === 0) continue;
    opsWith4xx++;

    let hasSchema = false;
    for (const code of errorCodes) {
      const resp = op.responses[code];
      if (resp?.content) {
        for (const [mediaType, mediaTypeObj] of Object.entries(resp.content)) {
          if (mediaType.includes("application/problem+json")) {
            hasProblemJson = true;
          }
          if (mediaTypeObj?.schema) {
            hasSchema = true;
          }
        }
      }
      if (resp?.description && resp.description.trim().length > 0) {
        hasSchema = true;
      }
    }
    if (hasSchema) opsWithErrorSchemas++;
  }

  if (opsWith4xx === 0) {
    return { outcome: "absent", detail: "No error responses (4xx/5xx) declared in any operation" };
  }

  if (opsWithErrorSchemas === operations.length && hasProblemJson) {
    return { outcome: "found", detail: `All ${opsWithErrorSchemas} operations have error schemas (RFC 9457 problem+json detected)` };
  }
  if (opsWithErrorSchemas === operations.length) {
    return { outcome: "found", detail: `All ${opsWithErrorSchemas} operations have error schemas` };
  }
  if (opsWithErrorSchemas > 0) {
    return { outcome: "partial", detail: `${opsWithErrorSchemas} of ${operations.length} operations have error schemas` };
  }
  return { outcome: "absent", detail: "Error responses declared but none have schemas or descriptions" };
};

// ─── Pricing / Rate limits helpers ─────────────────────────────────────────

interface PricingDeclaration {
  source: string;
  pricePerCall?: string;
  rateLimit?: string;
}

function extractPricingFromGuide(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  try {
    const json = JSON.parse(snap.body) as Record<string, unknown>;
    const pricing = json.pricing as Record<string, unknown> | undefined;
    if (pricing && typeof pricing === "object") {
      return {
        source: "guide",
        pricePerCall: typeof pricing.price_per_call === "string" ? pricing.price_per_call : undefined,
        rateLimit: typeof pricing.rate_limit === "string" ? pricing.rate_limit : undefined,
      };
    }
  } catch {
    // Not JSON — check prose for pricing keywords
    const lower = snap.body.toLowerCase();
    if (lower.includes("pricing") || lower.includes("cost") || lower.includes("$0.")) {
      return { source: "guide", pricePerCall: "prose-only" };
    }
  }
  return null;
}

function extractPricingFromOpenApi(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return null;
  const ext = (spec as unknown as Record<string, unknown>).x_pricing as Record<string, unknown> | undefined;
  if (ext && typeof ext === "object") {
    return {
      source: "openapi",
      pricePerCall: typeof ext.price_per_call === "string" ? ext.price_per_call : undefined,
      rateLimit: typeof ext.rate_limit === "string" ? ext.rate_limit : undefined,
    };
  }
  return null;
}

function extractPricingFromWellKnown(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  try {
    const json = JSON.parse(snap.body) as Record<string, unknown>;
    if (typeof json === "object" && json !== null) {
      return {
        source: "pricing.json",
        pricePerCall: typeof json.price_per_call === "string" ? json.price_per_call : undefined,
        rateLimit: typeof json.rate_limit === "string" ? json.rate_limit : undefined,
      };
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function extractPricingFromLlms(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const lower = snap.body.toLowerCase();
  // Structured section: "## Pricing" or "## Rate Limits" with key-value lines
  const hasPricingSection = lower.includes("## pricing") || lower.includes("## cost");
  const hasRateSection = lower.includes("## rate") || lower.includes("## limits");
  if (!hasPricingSection && !hasRateSection) {
    // Prose-only: mentions pricing/cost somewhere
    if (lower.includes("pricing") || lower.includes("cost per") || lower.includes("$0.")) {
      return { source: "llms", pricePerCall: "prose-only" };
    }
    return null;
  }
  // Try to extract structured values
  const priceMatch = snap.body.match(/price[_\s-]*per[_\s-]*call\s*[:=]\s*\S+/i);
  const rateMatch = snap.body.match(/rate[_\s-]*limit\s*[:=]\s*\S+/i);
  return {
    source: "llms",
    pricePerCall: priceMatch?.[0]?.split(/[:=]/)[1]?.trim(),
    rateLimit: rateMatch?.[0]?.split(/[:=]/)[1]?.trim(),
  };
}

function extractRateLimitFromGuide(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  try {
    const json = JSON.parse(snap.body) as Record<string, unknown>;
    const rateLimits = json.rate_limits as Record<string, unknown> | undefined;
    if (rateLimits && typeof rateLimits === "object") {
      return {
        source: "guide",
        rateLimit: typeof rateLimits.requests_per_minute === "string"
          ? rateLimits.requests_per_minute as string
          : JSON.stringify(rateLimits),
      };
    }
  } catch {
    const lower = snap.body.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("requests per")) {
      return { source: "guide", rateLimit: "prose-only" };
    }
  }
  return null;
}

function extractRateLimitFromOpenApi(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const spec = parseJsonBody(snap) as OpenApiSpec | null;
  if (!spec) return null;
  const ext = (spec as unknown as Record<string, unknown>).x_rate_limit as Record<string, unknown> | undefined;
  if (ext && typeof ext === "object") {
    return {
      source: "openapi",
      rateLimit: typeof ext.requests_per_minute === "string"
        ? ext.requests_per_minute as string
        : JSON.stringify(ext),
    };
  }
  return null;
}

function extractRateLimitFromLlms(snap: ResponseSnapshot | null): PricingDeclaration | null {
  if (!snap?.body) return null;
  const lower = snap.body.toLowerCase();
  const hasRateSection = lower.includes("## rate") || lower.includes("## limits");
  if (!hasRateSection && !lower.includes("rate limit") && !lower.includes("requests per")) {
    return null;
  }
  const rateMatch = snap.body.match(/rate[_\s-]*limit\s*[:=]\s*\S+/i);
  if (rateMatch) {
    return { source: "llms", rateLimit: rateMatch[0]?.split(/[:=]/)[1]?.trim() };
  }
  return { source: "llms", rateLimit: "prose-only" };
}

// ─── AB-150: Pricing discoverability ────────────────────────────────────────

const checkerPricingDiscoverability: SemanticChecker = (sources) => {
  const guideDecl = extractPricingFromGuide(sources.guide ?? null);
  const openApiDecl = extractPricingFromOpenApi(sources.openapi ?? null);
  const wellKnownDecl = extractPricingFromWellKnown(sources.pricing ?? null);
  const llmsDecl = extractPricingFromLlms(sources.llms ?? null);

  const machineReadable = [guideDecl, openApiDecl, wellKnownDecl].filter(
    (d) => d !== null && d.pricePerCall !== "prose-only",
  );
  const proseOnly = [guideDecl, llmsDecl].filter(
    (d) => d !== null && d.pricePerCall === "prose-only",
  );

  const hasAnySource = sources.guide || sources.openapi || sources.pricing || sources.llms;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  if (machineReadable.length > 0) {
    const srcs = machineReadable.map((d) => d!.source).join(", ");
    return { outcome: "found", detail: `Machine-readable pricing found in: ${srcs}` };
  }
  if (proseOnly.length > 0) {
    const srcs = proseOnly.map((d) => d!.source).join(", ");
    return { outcome: "partial", detail: `Pricing mentioned in prose only: ${srcs}` };
  }
  return { outcome: "absent", detail: "No pricing information found in any source" };
};

// ─── AB-151: Rate limits machine-readable ───────────────────────────────────

const checkerRateLimitsMachineReadable: SemanticChecker = (sources) => {
  const guideDecl = extractRateLimitFromGuide(sources.guide ?? null);
  const openApiDecl = extractRateLimitFromOpenApi(sources.openapi ?? null);
  const llmsDecl = extractRateLimitFromLlms(sources.llms ?? null);

  const machineReadable = [guideDecl, openApiDecl].filter(
    (d) => d !== null && d.rateLimit !== "prose-only",
  );
  const proseOnly = [guideDecl, llmsDecl].filter(
    (d) => d !== null && d.rateLimit === "prose-only",
  );

  const hasAnySource = sources.guide || sources.openapi || sources.llms;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  // Check for 429 over-limit behavior documentation
  const guideBody = sources.guide?.body ?? "";
  const llmsBody = sources.llms?.body ?? "";
  const has429Doc = guideBody.includes("429") || llmsBody.includes("429") ||
    guideBody.toLowerCase().includes("retry-after") || llmsBody.toLowerCase().includes("retry-after");

  if (machineReadable.length > 0 && has429Doc) {
    const srcs = machineReadable.map((d) => d!.source).join(", ");
    return { outcome: "found", detail: `Machine-readable rate limits in: ${srcs} (429 behavior documented)` };
  }
  if (machineReadable.length > 0) {
    const srcs = machineReadable.map((d) => d!.source).join(", ");
    return { outcome: "partial", detail: `Machine-readable rate limits in: ${srcs} but no 429 behavior documented` };
  }
  if (proseOnly.length > 0) {
    const srcs = proseOnly.map((d) => d!.source).join(", ");
    return { outcome: "partial", detail: `Rate limits mentioned in prose only: ${srcs}` };
  }
  return { outcome: "absent", detail: "No rate limit information found in any source" };
};

// ─── AB-152: Pricing/limits cross-source consistency ────────────────────────

export function findPricingDeclarations(sources: Snapshots): PricingDeclaration[] {
  const decls: PricingDeclaration[] = [];
  const guide = extractPricingFromGuide(sources.guide ?? null);
  if (guide) decls.push(guide);
  const openapi = extractPricingFromOpenApi(sources.openapi ?? null);
  if (openapi) decls.push(openapi);
  const wellKnown = extractPricingFromWellKnown(sources.pricing ?? null);
  if (wellKnown) decls.push(wellKnown);
  return decls;
}

const checkerPricingLimitsConsistency: SemanticChecker = (sources) => {
  const decls = findPricingDeclarations(sources);
  const hasAnySource = sources.guide || sources.openapi || sources.pricing;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  // Filter to declarations with actual price values (not prose-only)
  const priced = decls.filter((d) => d.pricePerCall && d.pricePerCall !== "prose-only");

  if (priced.length === 0) {
    return { outcome: "absent", detail: "No machine-readable pricing declarations found to cross-check" };
  }

  if (priced.length === 1) {
    return { outcome: "found", detail: `Single source (${priced[0].source}): ${priced[0].pricePerCall} — no conflict possible` };
  }

  // Compare values across sources
  const values = priced.map((d) => d.pricePerCall);
  const allMatch = values.every((v) => v === values[0]);

  if (allMatch) {
    return { outcome: "found", detail: `Pricing consistent across ${priced.length} sources: ${values[0]}` };
  }

  const conflictDetails = priced.map((d) => `${d.source}=${d.pricePerCall}`).join(", ");
  return { outcome: "absent", detail: `Pricing CONFLICT across sources: ${conflictDetails}` };
};

// ─── AB-153: Authentication clarity ─────────────────────────────────────────

const checkerAuthenticationClarity: SemanticChecker = (sources) => {
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

const checkerRetrySemanticsDeclared: SemanticChecker = (sources) => {
  const openapiSnap = sources.openapi;
  const guideSnap = sources.guide;
  const hasAnySource = openapiSnap || guideSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let idempotencyDeclared = false;
  let retryAfterDeclared = false;
  let retryGuidance = false;

  // Check OpenAPI for Idempotency-Key parameter and Retry-After in responses
  if (openapiSnap?.body) {
    const spec = parseJsonBody(openapiSnap) as OpenApiSpec | null;
    if (spec) {
      const operations = getOperations(spec);
      for (const { op } of operations) {
        // Check parameters for Idempotency-Key
        if (op.parameters) {
          for (const param of op.parameters) {
            if (param.name && param.name.toLowerCase().includes("idempotency")) {
              idempotencyDeclared = true;
            }
          }
        }
        // Check responses for Retry-After header or 429/5xx descriptions
        if (op.responses) {
          for (const [code, resp] of Object.entries(op.responses)) {
            if ((code.startsWith("4") || code.startsWith("5")) && resp?.description) {
              if (resp.description.toLowerCase().includes("retry-after")) {
                retryAfterDeclared = true;
              }
            }
          }
        }
      }
    }
  }

  // Check guide for retry guidance
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("idempotency") || lower.includes("idempotency-key")) {
      idempotencyDeclared = true;
    }
    if (lower.includes("retry-after") || lower.includes("retry after")) {
      retryAfterDeclared = true;
    }
    if (lower.includes("retry") && (lower.includes("429") || lower.includes("backoff") ||
      lower.includes("exponential") || lower.includes("guidance") || lower.includes("safe to retry"))) {
      retryGuidance = true;
    }
  }

  const score = [idempotencyDeclared, retryAfterDeclared, retryGuidance].filter(Boolean).length;
  if (score >= 2) {
    const parts: string[] = [];
    if (idempotencyDeclared) parts.push("idempotency");
    if (retryAfterDeclared) parts.push("retry-after");
    if (retryGuidance) parts.push("retry guidance");
    return { outcome: "found", detail: `Retry semantics declared: ${parts.join(", ")}` };
  }
  if (score === 1) {
    const part = idempotencyDeclared ? "idempotency" : retryAfterDeclared ? "retry-after" : "retry guidance";
    return { outcome: "partial", detail: `Partial retry semantics: only ${part} declared` };
  }
  return { outcome: "absent", detail: "No retry semantics found in any source" };
};

// ─── AB-155: Versioning declared ────────────────────────────────────────────

const checkerVersioningDeclared: SemanticChecker = (sources) => {
  const openapiSnap = sources.openapi;
  const guideSnap = sources.guide;
  const hasAnySource = openapiSnap || guideSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let versionPresent = false;
  let versionedPaths = false;
  let deprecationPolicy = false;
  let sunsetHeader = false;

  // Check OpenAPI info.version
  if (openapiSnap?.body) {
    const spec = parseJsonBody(openapiSnap) as OpenApiSpec | null;
    if (spec) {
      const info = (spec as unknown as Record<string, unknown>).info as Record<string, unknown> | undefined;
      if (info?.version && typeof info.version === "string" && info.version.trim().length > 0) {
        versionPresent = true;
      }
      // Check for versioned paths (e.g., /v1/users)
      if (spec.paths) {
        for (const path of Object.keys(spec.paths)) {
          if (/\/v\d+[\/]/.test(path) || /\/api\/v\d+/.test(path)) {
            versionedPaths = true;
            break;
          }
        }
      }
      // Check for Sunset header in responses
      const operations = getOperations(spec);
      for (const { op } of operations) {
        if (op.responses) {
          for (const resp of Object.values(op.responses)) {
            const headers = (resp as unknown as Record<string, unknown>)?.headers as Record<string, unknown> | undefined;
            if (headers?.Sunset || headers?.sunset) {
              sunsetHeader = true;
            }
          }
        }
      }
    }
  }

  // Check guide for deprecation policy
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("deprecat") || lower.includes("sunset") || lower.includes("end of life") ||
      lower.includes("eol") || lower.includes("retire")) {
      deprecationPolicy = true;
    }
    if (lower.includes("version") || lower.includes("v1") || lower.includes("v2")) {
      versionPresent = true;
    }
  }

  if (sunsetHeader) deprecationPolicy = true;

  if (versionPresent && deprecationPolicy) {
    const parts: string[] = ["version"];
    if (versionedPaths) parts.push("versioned paths");
    if (deprecationPolicy) parts.push("deprecation policy");
    return { outcome: "found", detail: `Versioning declared: ${parts.join(", ")}` };
  }
  if (versionPresent) {
    return { outcome: "partial", detail: "Version declared but no deprecation policy" };
  }
  return { outcome: "absent", detail: "No versioning information found in any source" };
};

// ─── AB-156: Sandbox environment declared ───────────────────────────────────

const checkerSandboxDeclared: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const openapiSnap = sources.openapi;
  const llmsSnap = sources.llms;
  const hasAnySource = guideSnap || openapiSnap || llmsSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let sandboxMentioned = false;
  let sandboxUrl = false;

  // Check guide for sandbox/test environment
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("sandbox") || lower.includes("test environment") || lower.includes("test mode") || lower.includes("staging")) {
      sandboxMentioned = true;
      // Check for URL pattern
      if (lower.includes("http") && (lower.includes("sandbox") || lower.includes("staging") || lower.includes("test"))) {
        sandboxUrl = true;
      }
      // Check guide JSON for sandbox/testEnvironment field
      const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
      if (guideJson) {
        const sandbox = (guideJson as Record<string, unknown>).sandbox as Record<string, unknown> | undefined;
        const testEnv = (guideJson as Record<string, unknown>).testEnvironment as Record<string, unknown> | undefined;
        const staging = (guideJson as Record<string, unknown>).staging as Record<string, unknown> | undefined;
        const sandboxObj = sandbox ?? testEnv ?? staging;
        if (sandboxObj) {
          if (typeof sandboxObj === "string" && sandboxObj.includes("http")) sandboxUrl = true;
          if (typeof sandboxObj === "object" && sandboxObj !== null) {
            const url = (sandboxObj as Record<string, unknown>).url as string | undefined;
            const baseUrl = (sandboxObj as Record<string, unknown>).baseUrl as string | undefined;
            if (url?.includes("http") || baseUrl?.includes("http")) sandboxUrl = true;
          }
        }
      }
    }
  }

  // Check OpenAPI servers for sandbox
  if (openapiSnap?.body) {
    const spec = parseJsonBody(openapiSnap) as OpenApiSpec | null;
    if (spec) {
      const servers = (spec as unknown as Record<string, unknown>).servers as Array<Record<string, unknown>> | undefined;
      if (servers) {
        for (const server of servers) {
          const url = server?.url as string | undefined;
          const desc = server?.description as string | undefined;
          if (url && (url.includes("sandbox") || url.includes("staging") || url.includes("test"))) {
            sandboxMentioned = true;
            sandboxUrl = true;
          }
          if (desc && (desc.toLowerCase().includes("sandbox") || desc.toLowerCase().includes("test"))) {
            sandboxMentioned = true;
            if (url) sandboxUrl = true;
          }
        }
      }
    }
  }

  // Check llms.txt for sandbox section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("sandbox") || lower.includes("test environment") || lower.includes("staging")) {
      sandboxMentioned = true;
      if (lower.includes("http") && (lower.includes("sandbox") || lower.includes("staging"))) {
        sandboxUrl = true;
      }
    }
  }

  if (sandboxMentioned && sandboxUrl) {
    return { outcome: "found", detail: "Sandbox/test environment declared with base URL" };
  }
  if (sandboxMentioned) {
    return { outcome: "partial", detail: "Sandbox mentioned by name but no base URL provided" };
  }
  return { outcome: "absent", detail: "No sandbox or test environment found in any source" };
};

// ─── AB-157: Agent policy machine-readable ──────────────────────────────────

const checkerAgentPolicyMachineReadable: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const llmsSnap = sources.llms;
  const aiTxtSnap = sources.ai_txt;
  const hasAnySource = guideSnap || llmsSnap || aiTxtSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let explicitPolicy = false;
  let tosLinkOnly = false;

  // Check agents.txt / ai.txt for explicit Allow/Disallow
  const aiTxtBody = aiTxtSnap?.body ?? "";
  if (aiTxtBody) {
    const lower = aiTxtBody.toLowerCase();
    if (lower.includes("allow:") || lower.includes("disallow:") || lower.includes("user-agent:")) {
      // Check for AI-agent-specific rules beyond crawler defaults
      // "agent" and "bot" alone are crawler terms; look for AI-specific identifiers
      if (lower.includes("ai") || lower.includes("gpt") || lower.includes("claude") || lower.includes("automated") || lower.includes("llm") || lower.includes("permitted") || lower.includes("prohibited")) {
        explicitPolicy = true;
      }
    }
  }

  // Check guide for policy/allowedUse field
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("policy") || lower.includes("allowed use") || lower.includes("alloweduse") || lower.includes("agent policy") || lower.includes("automated") || lower.includes("permitted")) {
      if (lower.includes("allow") || lower.includes("disallow") || lower.includes("permitted") || lower.includes("prohibited") || lower.includes("restricted")) {
        explicitPolicy = true;
      }
    }
    // Generic ToS link only
    if (lower.includes("terms of service") || lower.includes("/tos") || lower.includes("/terms") || lower.includes("/legal")) {
      if (!explicitPolicy) tosLinkOnly = true;
    }
  }

  // Check llms.txt for policy section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("## policy") || lower.includes("## agent policy") || lower.includes("allowed") || lower.includes("disallowed")) {
      explicitPolicy = true;
    }
  }

  if (explicitPolicy) {
    return { outcome: "found", detail: "Machine-readable agent policy found" };
  }
  if (tosLinkOnly) {
    return { outcome: "partial", detail: "Only generic ToS link found, no agent-specific policy" };
  }
  return { outcome: "absent", detail: "No agent policy found in any source" };
};

// ─── AB-158: Capability list declared ───────────────────────────────────────

const checkerCapabilityListDeclared: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  if (!guideSnap) return { outcome: "no_source", detail: "No guide snapshot available" };

  let hasList = false;
  let hasDescriptions = false;

  const guideBody = guideSnap.body ?? "";
  if (!guideBody) return { outcome: "no_source", detail: "Guide snapshot has no body" };

  // Try parsing as JSON
  const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
  if (guideJson) {
    const capabilities = (guideJson as Record<string, unknown>).capabilities as unknown[] | undefined;
    const endpoints = (guideJson as Record<string, unknown>).endpoints as unknown[] | undefined;
    const features = (guideJson as Record<string, unknown>).features as unknown[] | undefined;
    const list = capabilities ?? endpoints ?? features;
    if (list && Array.isArray(list) && list.length > 0) {
      hasList = true;
      for (const item of list) {
        if (typeof item === "object" && item !== null) {
          const desc = (item as Record<string, unknown>).description as string | undefined;
          if (desc && desc.trim().length > 0) {
            hasDescriptions = true;
            break;
          }
        }
      }
    }
  }

  // Fallback: check guide body text for capability-like content
  if (!hasList) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("## capabilities") || lower.includes("## endpoints") || lower.includes("## features") || lower.includes("## what we do")) {
      hasList = true;
      // Check if items have descriptions (text after the list item)
      if (lower.includes("- ") && lower.split("- ").length > 3) {
        hasDescriptions = true;
      }
    }
  }

  if (hasList && hasDescriptions) {
    return { outcome: "found", detail: "Capability list with per-item descriptions found in guide" };
  }
  if (hasList) {
    return { outcome: "partial", detail: "Capability list present but items lack descriptions" };
  }
  return { outcome: "absent", detail: "No capability list found in guide" };
};

// ─── AB-159: Business constraints documented ────────────────────────────────

const checkerBusinessConstraintsDocumented: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const llmsSnap = sources.llms;
  const hasAnySource = guideSnap || llmsSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let perCapabilityConstraints = false;
  let globalConstraints = false;

  // Check guide for per-capability constraints
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
    if (guideJson) {
      const capabilities = (guideJson as Record<string, unknown>).capabilities as unknown[] | undefined;
      const endpoints = (guideJson as Record<string, unknown>).endpoints as unknown[] | undefined;
      const list = capabilities ?? endpoints;
      if (list && Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === "object" && item !== null) {
            const constraints = (item as Record<string, unknown>).constraints as unknown[] | Record<string, unknown> | undefined;
            const policies = (item as Record<string, unknown>).policies as unknown[] | Record<string, unknown> | undefined;
            const limits = (item as Record<string, unknown>).limits as Record<string, unknown> | undefined;
            if (constraints || policies || limits) {
              perCapabilityConstraints = true;
              break;
            }
          }
        }
      }
    }

    // Fallback: text-based check
    const lower = guideBody.toLowerCase();
    if (lower.includes("refund") || lower.includes("cancellation") || lower.includes("constraint") || lower.includes("limit") || lower.includes("window")) {
      if (lower.includes("per ") || lower.includes("each ") || lower.includes("for ") || lower.includes("capability") || lower.includes("endpoint")) {
        perCapabilityConstraints = true;
      } else {
        globalConstraints = true;
      }
    }
  }

  // Check llms.txt for constraints section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("## constraints") || lower.includes("## limits") || lower.includes("## policies")) {
      if (lower.includes("refund") || lower.includes("cancellation") || lower.includes("limit") || lower.includes("window")) {
        perCapabilityConstraints = true;
      } else {
        globalConstraints = true;
      }
    }
  }

  if (perCapabilityConstraints) {
    return { outcome: "found", detail: "Per-capability business constraints documented" };
  }
  if (globalConstraints) {
    return { outcome: "partial", detail: "Global constraints mentioned but not per-capability" };
  }
  return { outcome: "absent", detail: "No business constraints found in any source" };
};

// ─── AB-160: Support path declared ──────────────────────────────────────────

const checkerSupportPathDeclared: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const llmsSnap = sources.llms;
  const securityTxtSnap = sources.security_txt;
  const hasAnySource = guideSnap || llmsSnap || securityTxtSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let dedicatedSupport = false;
  let genericContact = false;

  // Check guide for support field
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
    if (guideJson) {
      const support = (guideJson as Record<string, unknown>).support as Record<string, unknown> | string | undefined;
      if (support) {
        if (typeof support === "string" && (support.includes("@") || support.includes("http"))) {
          dedicatedSupport = true;
        } else if (typeof support === "object" && support !== null) {
          const email = (support as Record<string, unknown>).email as string | undefined;
          const url = (support as Record<string, unknown>).url as string | undefined;
          if (email?.includes("@") || url?.includes("http")) {
            dedicatedSupport = true;
          }
        }
      }
    }

    // Fallback: text-based
    const lower = guideBody.toLowerCase();
    if (lower.includes("support@") || lower.includes("support ") && lower.includes("email") || lower.includes("/support") || lower.includes("help@") || lower.includes("contact@")) {
      dedicatedSupport = true;
    }
    if (lower.includes("/contact") || lower.includes("contact us") || lower.includes("contact page")) {
      if (!dedicatedSupport) genericContact = true;
    }
  }

  // Check llms.txt for support section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("## support") || lower.includes("## contact") || lower.includes("support:")) {
      if (lower.includes("@") || lower.includes("http") || lower.includes("mailto:")) {
        dedicatedSupport = true;
      }
    }
  }

  // Check security.txt (RFC 9116) for Contact
  const securityTxtBody = securityTxtSnap?.body ?? "";
  if (securityTxtBody) {
    const lower = securityTxtBody.toLowerCase();
    if (lower.includes("contact:") && (lower.includes("mailto:") || lower.includes("http") || lower.includes("@"))) {
      dedicatedSupport = true;
    }
  }

  if (dedicatedSupport) {
    return { outcome: "found", detail: "Dedicated support contact declared" };
  }
  if (genericContact) {
    return { outcome: "partial", detail: "Only generic contact page URL found" };
  }
  return { outcome: "absent", detail: "No support contact found in any source" };
};

// ─── AB-161 (EPIC-125): AI-Agent Discovery meta tags ────────────────────────

interface HomepageMetaData {
  aiAgentDiscovery?: string | null;
  aiAgentOnboarding?: string | null;
  aiAgentDiscoveryReachable?: boolean;
  aiAgentOnboardingReachable?: boolean;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const checkerAiAgentDiscoveryMeta: SemanticChecker = (sources) => {
  const snap = sources.homepage_meta;
  if (!snap) return { outcome: "no_source", detail: "Homepage snapshot not found" };

  const parsed = parseJsonBody(snap) as { data?: HomepageMetaData } | null;
  if (!parsed || !parsed.data) {
    return { outcome: "no_source", detail: "Homepage meta data could not be parsed" };
  }

  const { aiAgentDiscovery, aiAgentOnboarding } = parsed.data;

  if (!aiAgentDiscovery && !aiAgentOnboarding) {
    return {
      outcome: "absent",
      detail: "Neither ai-agent-discovery nor ai-agent-onboarding meta tags found in HTML head",
    };
  }
  if (!aiAgentDiscovery) {
    return { outcome: "absent", detail: "Missing meta tag: ai-agent-discovery" };
  }
  if (!aiAgentOnboarding) {
    return { outcome: "absent", detail: "Missing meta tag: ai-agent-onboarding" };
  }
  if (!isValidHttpUrl(aiAgentDiscovery) || !isValidHttpUrl(aiAgentOnboarding)) {
    return {
      outcome: "absent",
      detail: "Meta tag URL invalid: ai-agent-discovery or ai-agent-onboarding is not a valid http(s) URL",
    };
  }
  if (!parsed.data.aiAgentDiscoveryReachable || !parsed.data.aiAgentOnboardingReachable) {
    const unreachable: string[] = [];
    if (!parsed.data.aiAgentDiscoveryReachable) unreachable.push("ai-agent-discovery");
    if (!parsed.data.aiAgentOnboardingReachable) unreachable.push("ai-agent-onboarding");
    return {
      outcome: "partial",
      detail: `Meta tag URL unreachable: ${unreachable.join(", ")}`,
    };
  }
  return {
    outcome: "found",
    detail: `Both ai-agent-discovery (${aiAgentDiscovery}) and ai-agent-onboarding (${aiAgentOnboarding}) meta tags present with reachable URLs`,
  };
};

// ─── AB-162 (EPIC-125): Heartbeat.md availability ───────────────────────────

const checkerHeartbeatMd: SemanticChecker = (sources) => {
  const snap = sources.heartbeat;
  if (!snap) return { outcome: "no_source", detail: "Heartbeat snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "/heartbeat.md not found (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `/heartbeat.md returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "/heartbeat.md returned empty body" };
  }

  const hasFrontmatter = body.trimStart().startsWith("---");
  if (!hasFrontmatter) {
    return {
      outcome: "partial",
      detail: "/heartbeat.md is Markdown but missing YAML frontmatter (---)",
    };
  }

  const lowerBody = body.toLowerCase();
  const hasKeyword = lowerBody.includes("heartbeat") || lowerBody.includes("check-in") || lowerBody.includes("checkin");
  if (!hasKeyword) {
    return {
      outcome: "partial",
      detail: "/heartbeat.md has frontmatter but missing 'heartbeat' or 'check-in' keyword",
    };
  }

  return {
    outcome: "found",
    detail: "/heartbeat.md is valid Markdown with YAML frontmatter and heartbeat content",
  };
};

// ─── AB-163 (EPIC-125): Skill.json (JSON-LD) availability ───────────────────

const checkerSkillJsonLd: SemanticChecker = (sources) => {
  const snap = sources.skill_json;
  if (!snap) return { outcome: "no_source", detail: "Skill.json snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "/skill.json not found (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `/skill.json returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "/skill.json returned empty body" };
  }

  const parsed = parseJsonBody(snap) as Record<string, unknown> | null;
  if (!parsed) {
    return { outcome: "absent", detail: "/skill.json is not valid JSON" };
  }

  const hasContext = "@context" in parsed;
  const hasType = "@type" in parsed;
  if (!hasContext || !hasType) {
    const missing: string[] = [];
    if (!hasContext) missing.push("@context");
    if (!hasType) missing.push("@type");
    return {
      outcome: "partial",
      detail: `/skill.json missing JSON-LD fields: ${missing.join(", ")}`,
    };
  }

  const hasName = "name" in parsed && typeof parsed.name === "string";
  const hasUrl = "url" in parsed || "endpoints" in parsed;
  if (!hasName || !hasUrl) {
    const missing: string[] = [];
    if (!hasName) missing.push("name");
    if (!hasUrl) missing.push("url or endpoints");
    return {
      outcome: "partial",
      detail: `/skill.json missing required fields: ${missing.join(", ")}`,
    };
  }

  return {
    outcome: "found",
    detail: `/skill.json is valid JSON-LD with @context, @type, name, and ${"url" in parsed ? "url" : "endpoints"}`,
  };
};

// ─── AB-164 (EPIC-125): Error catalog endpoint ───────────────────────────────

const checkerErrorCatalog: SemanticChecker = (sources) => {
  const snap = sources.error_catalog;
  if (!snap) return { outcome: "no_source", detail: "Error catalog snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "Error catalog endpoint not found (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `Error catalog endpoint returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "Error catalog endpoint returned empty body" };
  }

  const parsed = parseJsonBody(snap);
  if (!parsed) {
    return { outcome: "absent", detail: "Error catalog endpoint is not valid JSON" };
  }

  // Accept either an array of errors or an object with an errors array
  let errors: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    errors = parsed;
  } else if (parsed && typeof parsed === "object" && "errors" in parsed && Array.isArray((parsed as Record<string, unknown>).errors)) {
    errors = (parsed as Record<string, unknown>).errors as unknown[];
  }

  if (!errors || errors.length === 0) {
    return {
      outcome: "partial",
      detail: "Error catalog JSON is valid but contains no error entries",
    };
  }

  // Check if at least some entries have code/description fields
  const sample = errors.slice(0, Math.min(5, errors.length));
  const withCode = sample.filter((e) => e && typeof e === "object" && ("code" in e || "error" in e || "id" in e));
  if (withCode.length === 0) {
    return {
      outcome: "partial",
      detail: "Error catalog entries lack 'code', 'error', or 'id' fields",
    };
  }

  return {
    outcome: "found",
    detail: `Error catalog endpoint serves ${errors.length} error entries in JSON format`,
  };
};

const checkerAgentFeeds: SemanticChecker = (sources) => {
  const snap = sources.agent_feeds;
  if (!snap) return { outcome: "no_source", detail: "Agent feeds snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "No agent feeds found at common paths (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `Agent feeds endpoint returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "Agent feeds endpoint returned empty body" };
  }

  // Try JSON Feed format first
  const parsed = parseJsonBody(snap);
  if (parsed && typeof parsed === "object" && "version" in parsed) {
    const version = (parsed as Record<string, unknown>).version;
    if (typeof version === "string" && version.startsWith("https://jsonfeed.org/")) {
      const items = "items" in parsed && Array.isArray((parsed as Record<string, unknown>).items)
        ? (parsed as Record<string, unknown>).items as unknown[]
        : [];
      return {
        outcome: "found",
        detail: `Valid JSON Feed (${version}) with ${items.length} items`,
      };
    }
    return {
      outcome: "partial",
      detail: "JSON response has 'version' field but not a valid JSON Feed version URL",
    };
  }

  // Try RSS format (XML with <rss> root and <channel>)
  const lowerBody = body.toLowerCase();
  if (lowerBody.includes("<rss") && lowerBody.includes("<channel")) {
    const itemCount = (lowerBody.match(/<item[\s>]/g) || []).length;
    return {
      outcome: "found",
      detail: `Valid RSS 2.0 feed with ${itemCount} items`,
    };
  }

  // Not a recognized feed format
  return {
    outcome: "partial",
    detail: "Feed endpoint returned content but not a valid JSON Feed 1.1 or RSS 2.0 format",
  };
};

export const SEMANTIC_CHECKERS: Record<string, SemanticChecker> = {
  openapi_operation_descriptions: checkerOpenapiOperationDescriptions,
  openapi_parameter_semantics: checkerOpenapiParameterSemantics,
  openapi_examples: checkerOpenapiExamples,
  openapi_error_schemas: checkerOpenapiErrorSchemas,
  pricing_discoverability: checkerPricingDiscoverability,
  rate_limits_machine_readable: checkerRateLimitsMachineReadable,
  pricing_limits_consistency: checkerPricingLimitsConsistency,
  authentication_clarity: checkerAuthenticationClarity,
  retry_semantics_declared: checkerRetrySemanticsDeclared,
  versioning_declared: checkerVersioningDeclared,
  sandbox_declared: checkerSandboxDeclared,
  agent_policy_machine_readable: checkerAgentPolicyMachineReadable,
  capability_list_declared: checkerCapabilityListDeclared,
  business_constraints_documented: checkerBusinessConstraintsDocumented,
  support_path_declared: checkerSupportPathDeclared,
  ai_agent_discovery_meta: checkerAiAgentDiscoveryMeta,
  heartbeat_md: checkerHeartbeatMd,
  skill_json_ld: checkerSkillJsonLd,
  error_catalog: checkerErrorCatalog,
  agent_feeds: checkerAgentFeeds,
};

