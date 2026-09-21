// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiSpec, getOperations } from "./helpers";

export const checkerVersioningDeclared: SemanticChecker = (sources) => {
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
