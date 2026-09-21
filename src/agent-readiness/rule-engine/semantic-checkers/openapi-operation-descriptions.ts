// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiSpec, getOperations } from "./helpers";

export const checkerOpenapiOperationDescriptions: SemanticChecker = (sources) => {
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
