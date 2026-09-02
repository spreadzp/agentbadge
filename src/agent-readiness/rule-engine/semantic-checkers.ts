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

interface OpenApiOperation {
  description?: string;
  parameters?: Array<{
    name?: string;
    in?: string;
    description?: string;
    required?: boolean;
    schema?: unknown;
  }>;
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

export const SEMANTIC_CHECKERS: Record<string, SemanticChecker> = {
  openapi_operation_descriptions: checkerOpenapiOperationDescriptions,
  openapi_parameter_semantics: checkerOpenapiParameterSemantics,
};
