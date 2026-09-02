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

export const SEMANTIC_CHECKERS: Record<string, SemanticChecker> = {
  openapi_operation_descriptions: checkerOpenapiOperationDescriptions,
  openapi_parameter_semantics: checkerOpenapiParameterSemantics,
  openapi_examples: checkerOpenapiExamples,
  openapi_error_schemas: checkerOpenapiErrorSchemas,
  pricing_discoverability: checkerPricingDiscoverability,
  rate_limits_machine_readable: checkerRateLimitsMachineReadable,
  pricing_limits_consistency: checkerPricingLimitsConsistency,
};
