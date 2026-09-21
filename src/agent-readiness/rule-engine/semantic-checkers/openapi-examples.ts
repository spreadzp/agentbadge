// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiSpec, getOperations } from "./helpers";

export const checkerOpenapiExamples: SemanticChecker = (sources) => {
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
