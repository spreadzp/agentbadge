// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiSpec, getOperations } from "./helpers";

export const checkerOpenapiErrorSchemas: SemanticChecker = (sources) => {
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
