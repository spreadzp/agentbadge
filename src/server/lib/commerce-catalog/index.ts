/**
 * Commerce catalog — canonical product/price source for checkout 2.0
 * (EPIC-221, SLICE-221-1; D-221-2 unified catalog, D-221-8 metadata schema).
 *
 * Pure module, zero IO: HBAR dual pricing is a projection of the
 * service-catalog passport source (`TIER_PRICES_TINYBARS`) injected via
 * `CommerceCatalogSources` — prices are never hardcoded a second time.
 * USD amounts are decimal strings (D-220 money rule); conversion to
 * cents/base units happens only at rail-adapter boundaries.
 *
 * Legacy `FIAT_PRODUCTS` (lib/pricing.ts) is a compatibility projection
 * of this catalog until SLICE-221-5 removes it.
 */
import {
  TIER_PRICES_TINYBARS,
  TINYBAR_PER_HBAR,
} from "@agentbadge/passport/payment";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What activates the entitlement after payment confirmation (D-221-4). */
export type FulfillmentKind = "passport-mint" | "directory-listing";

export interface CommercePrice {
  /** Decimal string ("9.99" USD, "10" HBAR) — never a float. */
  amount: string;
  currency: "USD" | "HBAR";
  active: boolean;
}

/** Declarative metadata contract per productCode (D-221-8): the payments
 *  API validates `metadata` against this BEFORE creating a payment —
 *  no "paid but no fulfillment data" state. */
export interface MetadataSchema {
  required: string[];
  optional: string[];
}

export interface CommerceProduct {
  productCode: string;
  name: string;
  description: string;
  active: boolean;
  prices: CommercePrice[];
  metadataSchema: MetadataSchema;
  fulfillmentKind: FulfillmentKind;
}

/** Injected catalog inputs (defaultSources pattern from service-catalog). */
export interface CommerceCatalogSources {
  passport: { tiers: { tier: string; price_hbar: string }[] };
}

export function defaultCommerceSources(): CommerceCatalogSources {
  return {
    passport: {
      tiers: Object.entries(TIER_PRICES_TINYBARS).map(([tier, tb]) => ({
        tier,
        price_hbar: (tb / TINYBAR_PER_HBAR).toString(),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Metadata field contracts (D-221-8)
// ---------------------------------------------------------------------------

type FieldType = "string" | "string[]";

const PASSPORT_METADATA_FIELDS: Record<string, FieldType> = {
  accountId: "string",
  name: "string",
  capabilities: "string[]",
  endpoint: "string",
  skills: "string[]",
  imageUrl: "string",
};

const PASSPORT_METADATA_SCHEMA: MetadataSchema = {
  required: ["accountId", "name", "capabilities"],
  optional: ["endpoint", "skills", "imageUrl"],
};

const LISTING_METADATA_FIELDS: Record<string, FieldType> = {
  listingId: "string",
};

const LISTING_METADATA_SCHEMA: MetadataSchema = {
  required: ["listingId"],
  optional: [],
};

const FIELD_TYPES_BY_KIND: Record<FulfillmentKind, Record<string, FieldType>> = {
  "passport-mint": PASSPORT_METADATA_FIELDS,
  "directory-listing": LISTING_METADATA_FIELDS,
};

// ---------------------------------------------------------------------------
// Product definitions (USD price is canonical; HBAR is a source projection)
// ---------------------------------------------------------------------------

interface ProductSeed {
  code: string;
  legacyId: string;
  name: string;
  description: string;
  usd: string;
  fulfillmentKind: FulfillmentKind;
  metadataSchema: MetadataSchema;
  tier?: string; // passport tiers only — enables HBAR dual pricing
}

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    code: "PASSPORT_BRONZE",
    legacyId: "passport-bronze",
    name: "Agent Passport — Bronze Tier",
    description: "Bronze tier on-chain agent passport NFT mint",
    usd: "9.99",
    fulfillmentKind: "passport-mint",
    metadataSchema: PASSPORT_METADATA_SCHEMA,
    tier: "bronze",
  },
  {
    code: "PASSPORT_SILVER",
    legacyId: "passport-silver",
    name: "Agent Passport — Silver Tier",
    description: "Silver tier on-chain agent passport NFT mint",
    usd: "49.99",
    fulfillmentKind: "passport-mint",
    metadataSchema: PASSPORT_METADATA_SCHEMA,
    tier: "silver",
  },
  {
    code: "PASSPORT_GOLD",
    legacyId: "passport-gold",
    name: "Agent Passport — Gold Tier",
    description: "Gold tier on-chain agent passport NFT mint",
    usd: "199.99",
    fulfillmentKind: "passport-mint",
    metadataSchema: PASSPORT_METADATA_SCHEMA,
    tier: "gold",
  },
  {
    code: "PASSPORT_PLATINUM",
    legacyId: "passport-platinum",
    name: "Agent Passport — Platinum Tier",
    description: "Platinum tier on-chain agent passport NFT mint",
    usd: "499.99",
    fulfillmentKind: "passport-mint",
    metadataSchema: PASSPORT_METADATA_SCHEMA,
    tier: "platinum",
  },
  {
    code: "DIRECTORY_LISTING",
    legacyId: "directory-listing",
    name: "AgentBadge Directory Listing",
    description: "Lifetime curated listing in the AgentBadge agent directory",
    usd: "29.99",
    fulfillmentKind: "directory-listing",
    metadataSchema: LISTING_METADATA_SCHEMA,
  },
];

// ---------------------------------------------------------------------------
// Builders / lookups
// ---------------------------------------------------------------------------

function buildProduct(
  seed: ProductSeed,
  src: CommerceCatalogSources,
): CommerceProduct {
  const prices: CommercePrice[] = [
    { amount: seed.usd, currency: "USD", active: true },
  ];
  if (seed.tier) {
    const native = src.passport.tiers.find((t) => t.tier === seed.tier);
    if (native) {
      prices.push({
        amount: native.price_hbar,
        currency: "HBAR",
        active: true,
      });
    }
  }
  return {
    productCode: seed.code,
    name: seed.name,
    description: seed.description,
    active: true,
    prices,
    metadataSchema: seed.metadataSchema,
    fulfillmentKind: seed.fulfillmentKind,
  };
}

/** Every checkout-purchasable product, in stable order. */
export function listCommerceProducts(
  src: CommerceCatalogSources = defaultCommerceSources(),
): CommerceProduct[] {
  return PRODUCT_SEEDS.map((s) => buildProduct(s, src));
}

export function getCommerceProduct(
  productCode: string,
  src: CommerceCatalogSources = defaultCommerceSources(),
): CommerceProduct | undefined {
  const seed = PRODUCT_SEEDS.find((s) => s.code === productCode);
  return seed ? buildProduct(seed, src) : undefined;
}

/** Legacy kebab productId → canonical productCode ("passport-bronze" → "PASSPORT_BRONZE"). */
export function productCodeForLegacyId(
  legacyProductId: string,
): string | undefined {
  return PRODUCT_SEEDS.find((s) => s.legacyId === legacyProductId)?.code;
}

/** Canonical productCode → legacy kebab productId. */
export function legacyProductIdFor(productCode: string): string | undefined {
  return PRODUCT_SEEDS.find((s) => s.code === productCode)?.legacyId;
}

// ---------------------------------------------------------------------------
// Metadata validation (D-221-8)
// ---------------------------------------------------------------------------

export type MetadataValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Validate `metadata` against the product's declared schema.
 * Unknown extra keys are allowed (forward-compat); declared fields are
 * type-checked and all `required` fields must be present and non-empty.
 */
export function validateProductMetadata(
  productCode: string,
  metadata: unknown,
): MetadataValidation {
  const product = getCommerceProduct(productCode);
  const errors: string[] = [];
  if (!product) {
    return { ok: false, errors: [`unknown productCode: ${productCode}`] };
  }
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return { ok: false, errors: ["metadata must be an object"] };
  }

  const md = metadata as Record<string, unknown>;
  const fieldTypes = FIELD_TYPES_BY_KIND[product.fulfillmentKind];

  for (const field of product.metadataSchema.required) {
    if (!(field in md) || md[field] === undefined || md[field] === null) {
      errors.push(`missing required field: ${field}`);
    }
  }

  for (const [field, value] of Object.entries(md)) {
    const expected = fieldTypes[field];
    if (!expected) continue; // undeclared keys pass through
    const typeOk =
      expected === "string"
        ? typeof value === "string" && value.length > 0
        : Array.isArray(value) && value.every((v) => typeof v === "string");
    if (!typeOk) {
      errors.push(`invalid type for ${field}: expected ${expected}`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
