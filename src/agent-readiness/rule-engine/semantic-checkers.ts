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

export const SEMANTIC_CHECKERS: Record<string, SemanticChecker> = {
  openapi_operation_descriptions: checkerOpenapiOperationDescriptions,
  openapi_parameter_semantics: checkerOpenapiParameterSemantics,
  openapi_examples: checkerOpenapiExamples,
  openapi_error_schemas: checkerOpenapiErrorSchemas,
};
