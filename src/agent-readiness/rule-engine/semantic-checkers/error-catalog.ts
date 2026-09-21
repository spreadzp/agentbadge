// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody } from "./helpers";

export const checkerErrorCatalog: SemanticChecker = (sources) => {
  const snap = sources.error_catalog;
  if (!snap) return { outcome: "no_source", detail: "Error catalog snapshot not found" };

  if (snap.status === 404 || snap.status === 0) {
    return { outcome: "absent", detail: "Error catalog endpoint not found (HTTP 404 or network error)" };
  }

  if (snap.status >= 400) {
    return { outcome: "absent", detail: `Error catalog endpoint returned HTTP ${snap.status}` };
  }

  const body = snap.body ?? "";
  if (!body) {
    return { outcome: "absent", detail: "Error catalog endpoint returned empty body" };
  }

  const parsed = parseJsonBody(snap);
  if (!parsed) {
    return { outcome: "absent", detail: "Error catalog endpoint is not valid JSON" };
  }

  // Accept either an array of errors or an object with an errors array
  let errors: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    errors = parsed;
  } else if (parsed && typeof parsed === "object" && "errors" in parsed && Array.isArray((parsed as Record<string, unknown>).errors)) {
    errors = (parsed as Record<string, unknown>).errors as unknown[];
  }

  if (!errors || errors.length === 0) {
    return {
      outcome: "partial",
      detail: "Error catalog JSON is valid but contains no error entries",
    };
  }

  // Check if at least some entries have code/description fields
  const sample = errors.slice(0, Math.min(5, errors.length));
  const withCode = sample.filter((e) => e && typeof e === "object" && ("code" in e || "error" in e || "id" in e));
  if (withCode.length === 0) {
    return {
      outcome: "partial",
      detail: "Error catalog entries lack 'code', 'error', or 'id' fields",
    };
  }

  return {
    outcome: "found",
    detail: `Error catalog endpoint serves ${errors.length} error entries in JSON format`,
  };
};
