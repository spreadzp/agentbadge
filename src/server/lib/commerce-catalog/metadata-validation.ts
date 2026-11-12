/**
 * Metadata validation (D-221-8) — extracted from `index.ts` to keep the
 * catalog module under the file-size lint cap.
 *
 * Per-field rules (SLICE-221-7, audit H-5): format + length per declared
 * field — metadata feeds fulfillment input and downstream logs/notify.
 */
import {
  getCommerceProduct,
  metadataFieldTypesFor,
  type CommerceProduct,
  type MetadataFieldType,
} from "./index.js";

export type MetadataValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

const STRING_MAX = 500;
const LIST_MAX_ITEMS = 20;
const LIST_ITEM_MAX = 100;
const METADATA_MAX_KEYS = 50;

interface FieldRule {
  /** Full-match regex for string fields. */
  pattern?: RegExp;
  patternHint?: string;
  maxLen?: number;
}

const FIELD_RULES: Record<string, FieldRule> = {
  accountId: { pattern: /^\d+\.\d+\.\d+$/, patternHint: "x.y.z", maxLen: 32 },
  name: { maxLen: 100 },
  endpoint: { pattern: /^https:\/\//, patternHint: "https:// URL", maxLen: 500 },
  imageUrl: { pattern: /^https:\/\//, patternHint: "https:// URL", maxLen: 500 },
  listingId: { maxLen: 200 },
};

function validateFieldValue(
  field: string,
  expected: MetadataFieldType,
  value: unknown,
): string | null {
  const rule = FIELD_RULES[field];
  if (expected === "string") {
    if (typeof value !== "string" || value.trim().length === 0) {
      return `invalid type for ${field}: expected non-empty string`;
    }
    const maxLen = rule?.maxLen ?? STRING_MAX;
    if (value.length > maxLen) {
      return `${field} exceeds ${maxLen} chars`;
    }
    if (rule?.pattern && !rule.pattern.test(value)) {
      return `${field} must match ${rule.patternHint ?? "required format"}`;
    }
    return null;
  }
  // string[]
  if (!Array.isArray(value)) {
    return `invalid type for ${field}: expected string[]`;
  }
  if (value.length === 0 || value.length > LIST_MAX_ITEMS) {
    return `${field} must have 1..${LIST_MAX_ITEMS} items`;
  }
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.trim().length === 0 ||
      item.length > LIST_ITEM_MAX
    ) {
      return `${field} items must be non-empty strings ≤${LIST_ITEM_MAX} chars`;
    }
  }
  return null;
}

function fieldTypesFor(productCode: string):
  | { product: CommerceProduct; fieldTypes: Record<string, MetadataFieldType> }
  | null {
  const product = getCommerceProduct(productCode);
  if (!product) return null;
  return { product, fieldTypes: metadataFieldTypesFor(product.fulfillmentKind) };
}

/**
 * Validate `metadata` against the product's declared schema.
 * STRICT (SLICE-221-7): undeclared keys are rejected — a stray
 * `paymentId`/`tier`/rail key must never reach the payment payload or
 * the webhook metadata surface. Declared fields are type-checked,
 * format-checked, and all `required` fields must be present and
 * non-empty.
 */
export function validateProductMetadata(
  productCode: string,
  metadata: unknown,
): MetadataValidation {
  const resolved = fieldTypesFor(productCode);
  const errors: string[] = [];
  if (!resolved) {
    return { ok: false, errors: [`unknown productCode: ${productCode}`] };
  }
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return { ok: false, errors: ["metadata must be an object"] };
  }

  const { product, fieldTypes } = resolved;
  const md = metadata as Record<string, unknown>;

  if (Object.keys(md).length > METADATA_MAX_KEYS) {
    errors.push(`metadata exceeds ${METADATA_MAX_KEYS} keys`);
  }

  for (const field of product.metadataSchema.required) {
    if (
      !Object.hasOwn(md, field) ||
      md[field] === undefined ||
      md[field] === null
    ) {
      errors.push(`missing required field: ${field}`);
    }
  }

  for (const [field, value] of Object.entries(md)) {
    if (!Object.hasOwn(fieldTypes, field)) {
      errors.push(`undeclared field: ${field}`);
      continue;
    }
    const err = validateFieldValue(field, fieldTypes[field], value);
    if (err) errors.push(err);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Pick declared fields only (trimmed) — the sanitized shape is what the
 * payment payload stores. Callers must validate first; sanitize is a
 * belt-and-braces second layer, not a validator.
 */
export function sanitizeProductMetadata(
  productCode: string,
  metadata: unknown,
): Record<string, unknown> {
  const resolved = fieldTypesFor(productCode);
  if (
    !resolved ||
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return {};
  }
  const { fieldTypes } = resolved;
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(
    metadata as Record<string, unknown>,
  )) {
    if (!Object.hasOwn(fieldTypes, field)) continue;
    if (fieldTypes[field] === "string" && typeof value === "string") {
      out[field] = value.trim();
    } else if (fieldTypes[field] === "string[]" && Array.isArray(value)) {
      out[field] = value.filter((v) => typeof v === "string");
    }
  }
  return out;
}
