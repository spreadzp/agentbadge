/**
 * EPIC-226 — evidence content predicates for FinOps admin actions.
 * Split from `guards.ts` for the 300-line module cap.
 *
 * H1/226-6 + N6-3 + N7-3/4: evidence must carry content — a string
 * with ≥1 VISIBLE char (zero-width/format/control chars and bare
 * "null"/"{}" literals don't count), an array with ≥1 meaningful
 * element, or an object with ≥1 meaningful VALUE (`{"a":""}` is an
 * empty husk). Nested numbers/booleans count as content; a bare
 * top-level scalar doesn't.
 */

// Zero-width/format/blank-fillers + control chars — invisible or
// non-printing, carry no content. Same class as operator labels
// (N7-4): hangul/braille fillers, Cf, Default_Ignorable, Cc.
const INVISIBLE_CHARS =
  /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cs}\u115F\u1160\u3164\uFFA0\u2800\u00AD\uFEFF\uFFFC]/gu;

// JSON-ish empty literals that deserialize to nothing.
const EMPTY_LITERALS = new Set(["", "null", "undefined", "{}", "[]"]);

// Depth-capped: structures inside the serialized bound can still be
// ~2k levels deep — past MAX_EVIDENCE_DEPTH a member is content by
// existence; we don't recurse, so the check can't blow the stack.
const MAX_EVIDENCE_DEPTH = 64;
const hasContent = (x: unknown, depth = 0): boolean => {
  if (typeof x === "number" || typeof x === "boolean") return true;
  if (x === undefined || x === null) return false;
  // F8-1: at the cap only SCALARS still count (a string is evaluated
  // without recursion) — a container deeper than the cap is NOT
  // assumed content, so wrappers can't smuggle an empty husk past
  // the check.
  if (depth >= MAX_EVIDENCE_DEPTH) {
    return typeof x === "string" && isMeaningfulEvidence(x);
  }
  if (typeof x === "string") return isMeaningfulEvidence(x);
  if (Array.isArray(x)) return x.some((m) => hasContent(m, depth + 1));
  if (typeof x === "object") {
    return Object.values(x as Record<string, unknown>).some((m) =>
      hasContent(m, depth + 1),
    );
  }
  return false;
};

export function isMeaningfulEvidence(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") {
    const s = v.replace(INVISIBLE_CHARS, "").trim();
    return !EMPTY_LITERALS.has(s.toLowerCase());
  }
  if (Array.isArray(v)) return v.some((m) => hasContent(m, 1));
  if (typeof v === "object") {
    return Object.values(v as Record<string, unknown>).some((m) =>
      hasContent(m, 1),
    );
  }
  return false; // bare scalar / other types are not evidence
}
