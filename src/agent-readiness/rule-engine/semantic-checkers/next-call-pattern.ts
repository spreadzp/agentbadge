// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody } from "./helpers";

export const checkerNextCallPattern: SemanticChecker = (sources) => {
  const snap = sources.openapi_standard;
  if (!snap) return { outcome: "no_source", detail: "OpenAPI snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "OpenAPI spec not found (HTTP 404 or network error)" };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "OpenAPI spec returned empty body" };
  }

  const parsed = parseJsonBody(snap);
  if (!parsed || typeof parsed !== "object") {
    return { outcome: "absent", detail: "OpenAPI spec is not valid JSON" };
  }

  const spec = parsed as Record<string, unknown>;
  const paths = spec.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== "object") {
    return { outcome: "partial", detail: "OpenAPI spec has no paths section" };
  }

  // Quick check: if next_call not mentioned anywhere in spec, it's absent
  const specStr = body.toLowerCase();
  if (!specStr.includes("next_call")) {
    return {
      outcome: "absent",
      detail: "No next_call field found in OpenAPI spec response schemas or examples",
    };
  }

  // Deep search for next_call in response schemas
  let foundWithFields = false;
  let foundPartial = false;

  const checkSchema = (schema: unknown): void => {
    if (!schema || typeof schema !== "object") return;
    const s = schema as Record<string, unknown>;
    const props = s.properties as Record<string, unknown> | undefined;
    if (props && "next_call" in props) {
      const nc = props.next_call as Record<string, unknown> | undefined;
      if (nc && typeof nc === "object") {
        const ncProps = nc.properties as Record<string, unknown> | undefined;
        if (ncProps && "method" in ncProps && "path" in ncProps && "why" in ncProps) {
          foundWithFields = true;
        } else {
          foundPartial = true;
        }
      } else {
        foundPartial = true;
      }
    }
    // Recurse into nested objects
    for (const key of ["properties", "items", "allOf", "oneOf", "anyOf"]) {
      const child = s[key];
      if (child && typeof child === "object") {
        if (Array.isArray(child)) {
          child.forEach(checkSchema);
        } else {
          checkSchema(child);
        }
      }
    }
  };

  // Walk all paths and operations
  for (const pathObj of Object.values(paths)) {
    if (!pathObj || typeof pathObj !== "object") continue;
    const operations = pathObj as Record<string, unknown>;
    for (const op of Object.values(operations)) {
      if (!op || typeof op !== "object") continue;
      const responses = (op as Record<string, unknown>).responses as Record<string, unknown> | undefined;
      if (!responses) continue;
      for (const resp of Object.values(responses)) {
        if (!resp || typeof resp !== "object") continue;
        const content = (resp as Record<string, unknown>).content as Record<string, unknown> | undefined;
        if (!content) continue;
        for (const mediaType of Object.values(content)) {
          if (!mediaType || typeof mediaType !== "object") continue;
          const schema = (mediaType as Record<string, unknown>).schema;
          if (schema) checkSchema(schema);
          // Also check examples for next_call
          const examples = (mediaType as Record<string, unknown>).examples as Record<string, unknown> | undefined;
          if (examples) {
            for (const ex of Object.values(examples)) {
              if (ex && typeof ex === "object") {
                const exValue = (ex as Record<string, unknown>).value;
                if (exValue && typeof exValue === "object") {
                  if ("next_call" in (exValue as Record<string, unknown>)) {
                    const nc = (exValue as Record<string, unknown>).next_call as Record<string, unknown> | undefined;
                    if (nc && "method" in nc && "path" in nc && "why" in nc) {
                      foundWithFields = true;
                    } else {
                      foundPartial = true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (foundWithFields) {
    return {
      outcome: "found",
      detail: "OpenAPI spec includes next_call pattern with method, path, and why fields in response schemas",
    };
  }

  if (foundPartial) {
    return {
      outcome: "partial",
      detail: "next_call field found in OpenAPI spec but missing required sub-fields (method, path, why)",
    };
  }

  // next_call string found in spec but not in structured schemas — could be in description text
  return {
    outcome: "partial",
    detail: "next_call mentioned in OpenAPI spec but not found in structured response schemas or examples",
  };
};
