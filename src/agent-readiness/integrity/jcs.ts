/**
 * RFC 8785 JSON Canonicalization Scheme.
 * Produces a deterministic UTF-8 string from any JSON-serializable value.
 */
export function canonicalizeJson(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return canonicalString(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => lexicographicCompare(a, b));
    return `{${entries.map(([k, v]) => `${canonicalString(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`Cannot canonicalize type: ${typeof value}`);
}

function canonicalString(s: string): string {
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20) {
      const shortEscapes: Record<number, string> = {
        0x08: "\\b",
        0x09: "\\t",
        0x0a: "\\n",
        0x0c: "\\f",
        0x0d: "\\r",
      };
      result += shortEscapes[code] ?? `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code === 0x22) {
      result += '\\"';
    } else if (code === 0x5c) {
      result += "\\\\";
    } else {
      result += s[i];
    }
  }
  result += '"';
  return result;
}

function canonicalNumber(n: number): string {
  if (Number.isNaN(n)) throw new Error("Cannot canonicalize NaN");
  if (n === Infinity) throw new Error("Cannot canonicalize Infinity");
  if (n === -Infinity) throw new Error("Cannot canonicalize -Infinity");

  if (Number.isInteger(n)) return String(n);

  const str = String(n);
  return str;
}

function lexicographicCompare(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}
