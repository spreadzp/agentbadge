// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiSpec, getOperations } from "./helpers";

export const checkerRetrySemanticsDeclared: SemanticChecker = (sources) => {
  const openapiSnap = sources.openapi;
  const guideSnap = sources.guide;
  const hasAnySource = openapiSnap || guideSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let idempotencyDeclared = false;
  let retryAfterDeclared = false;
  let retryGuidance = false;

  // Check OpenAPI for Idempotency-Key parameter and Retry-After in responses
  if (openapiSnap?.body) {
    const spec = parseJsonBody(openapiSnap) as OpenApiSpec | null;
    if (spec) {
      const operations = getOperations(spec);
      for (const { op } of operations) {
        // Check parameters for Idempotency-Key
        if (op.parameters) {
          for (const param of op.parameters) {
            if (param.name && param.name.toLowerCase().includes("idempotency")) {
              idempotencyDeclared = true;
            }
          }
        }
        // Check responses for Retry-After header or 429/5xx descriptions
        if (op.responses) {
          for (const [code, resp] of Object.entries(op.responses)) {
            if ((code.startsWith("4") || code.startsWith("5")) && resp?.description) {
              if (resp.description.toLowerCase().includes("retry-after")) {
                retryAfterDeclared = true;
              }
            }
          }
        }
      }
    }
  }

  // Check guide for retry guidance
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("idempotency") || lower.includes("idempotency-key")) {
      idempotencyDeclared = true;
    }
    if (lower.includes("retry-after") || lower.includes("retry after")) {
      retryAfterDeclared = true;
    }
    if (lower.includes("retry") && (lower.includes("429") || lower.includes("backoff") ||
      lower.includes("exponential") || lower.includes("guidance") || lower.includes("safe to retry"))) {
      retryGuidance = true;
    }
  }

  const score = [idempotencyDeclared, retryAfterDeclared, retryGuidance].filter(Boolean).length;
  if (score >= 2) {
    const parts: string[] = [];
    if (idempotencyDeclared) parts.push("idempotency");
    if (retryAfterDeclared) parts.push("retry-after");
    if (retryGuidance) parts.push("retry guidance");
    return { outcome: "found", detail: `Retry semantics declared: ${parts.join(", ")}` };
  }
  if (score === 1) {
    const part = idempotencyDeclared ? "idempotency" : retryAfterDeclared ? "retry-after" : "retry guidance";
    return { outcome: "partial", detail: `Partial retry semantics: only ${part} declared` };
  }
  return { outcome: "absent", detail: "No retry semantics found in any source" };
};

// ─── AB-155: Versioning declared ────────────────────────────────────────────
