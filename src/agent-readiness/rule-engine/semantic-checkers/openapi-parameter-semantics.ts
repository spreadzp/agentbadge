// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiOperation, type OpenApiSpec, getOperations } from "./helpers";

export const checkerOpenapiParameterSemantics: SemanticChecker = (sources) => {
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
