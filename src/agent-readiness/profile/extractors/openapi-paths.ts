import type { Evidence } from "../../rule-engine/evidence.types";
import type { KnowledgeProfile } from "../profile-schema";

/**
 * SLICE-101-3: OpenAPI path parser.
 * Extracts endpoint entries from OpenAPI evidence.
 */

export type EndpointEntry = NonNullable<NonNullable<KnowledgeProfile["capabilities"]>["data"]["endpoints"]>[number];

/**
 * Extract endpoint entries from OpenAPI evidence.
 * Handles both:
 * 1. Pre-parsed `paths` and `methods` arrays on OpenApiEvidence
 * 2. Raw spec JSON in `semantic_detail` string
 *
 * @param maxEndpoints - cap on number of endpoints (default 50)
 */
export function extractPaths(openapiEvidence: Evidence, maxEndpoints = 50): EndpointEntry[] {
  // Try raw spec JSON from semantic_detail first
  const detail = (openapiEvidence as { semantic_detail?: string }).semantic_detail;
  if (detail) {
    try {
      const spec = JSON.parse(detail);
      if (spec.paths && typeof spec.paths === "object") {
        return parseSpecPaths(spec.paths, maxEndpoints);
      }
    } catch {
      // Not JSON, fall through to pre-parsed arrays
    }
  }

  // Fall back to pre-parsed paths + methods arrays
  if (openapiEvidence.type === "openapi") {
    const paths = openapiEvidence.paths;
    const methods = openapiEvidence.methods;
    const endpoints: EndpointEntry[] = [];
    for (const path of paths) {
      for (const method of methods) {
        if (endpoints.length >= maxEndpoints) return endpoints;
        endpoints.push({ path, method: method.toUpperCase(), description: undefined });
      }
    }
    return endpoints;
  }

  return [];
}

/**
 * Parse a standard OpenAPI `paths` object into endpoint entries.
 */
function parseSpecPaths(pathsObj: Record<string, Record<string, { summary?: string; operationId?: string }>>, maxEndpoints: number): EndpointEntry[] {
  const endpoints: EndpointEntry[] = [];
  const validMethods = ["get", "post", "put", "patch", "delete", "head", "options"];

  for (const [path, operations] of Object.entries(pathsObj)) {
    for (const [method, op] of Object.entries(operations)) {
      if (!validMethods.includes(method.toLowerCase())) continue;
      if (endpoints.length >= maxEndpoints) return endpoints;
      endpoints.push({
        path,
        method: method.toUpperCase(),
        description: op?.summary,
        operationId: op?.operationId,
      } as EndpointEntry);
    }
  }

  return endpoints;
}
