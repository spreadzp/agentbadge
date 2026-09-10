/**
 * SLICE-102-1: Canonical JSON serializer.
 *
 * Deterministic JSON serialization for hash reproducibility.
 * - Sorted object keys (UTF-8 code point order)
 * - No whitespace between tokens
 * - UTF-8 encoding
 * - Used for all hash computations in Trust Snapshot
 */

/**
 * Canonicalize an object into deterministic JSON string.
 * Keys are sorted recursively, no whitespace, standard UTF-8.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    // Integer: no decimal point
    if (Number.isInteger(value)) return String(value);
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v)).join(",") + "}";
  }
  return "null";
}
