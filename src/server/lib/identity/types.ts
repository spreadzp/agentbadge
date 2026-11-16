/**
 * SLICE-225-2 (EPIC-225): identity domain types — actor types,
 * entitlement statuses/catalog, reputation fact types, errors.
 *
 * Actor = EVM wallet address, lowercase (D-225-3). The wallet is the
 * canonical key; agentId/passport/did/orgId are enrichment links —
 * never required for participation (spec: external executors).
 */

// ---------- actor types (D-225-3) ----------

export const ACTOR_TYPES = [
  "REGISTERED_USER",
  "REGISTERED_AGENT",
  "EXTERNAL_AGENT",
  "EXTERNAL_HUMAN",
  "ORGANIZATION",
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

// ---------- entitlement statuses + product catalog ----------

export const ENTITLEMENT_STATUSES = [
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/**
 * Entitlement-eligible product codes (spec §5.2). A confirmed payment
 * whose `productId` is in this catalog activates a matching
 * entitlement via the sweeper (D-225-4). Products NOT listed (e.g.
 * DIRECTORY_LISTING, scan packs) never produce entitlements.
 *
 * `validityMs` — grant duration; undefined = perpetual until revoked.
 * `minAmount`/`currency` — payment binding (audit C-2): when
 * declared, the sweeper only activates payments that paid at least
 * `minAmount` in `currency`. Entries without a declared price bind
 * only on productId + CONFIRMED status (see decisions D-225-8).
 */
export interface EntitlementCatalogEntry {
  productCode: string;
  validityMs?: number;
  /** Decimal-string floor in `currency` units — e.g. "9.99". */
  minAmount?: string;
  currency?: string;
}

export const ENTITLEMENT_PRODUCTS: readonly EntitlementCatalogEntry[] = [
  { productCode: "PASSPORT_BRONZE" },
  { productCode: "PASSPORT_SILVER" },
  { productCode: "PASSPORT_GOLD" },
  { productCode: "PASSPORT_PLATINUM" },
  { productCode: "READINESS_BASIC" },
  { productCode: "READINESS_PREMIUM" },
  { productCode: "API_ACCESS_STANDARD" },
  { productCode: "API_ACCESS_PRO" },
  { productCode: "MARKETPLACE_PARTICIPANT" },
  { productCode: "MULTI_AGENT" },
];

const catalogIndex = new Map(
  ENTITLEMENT_PRODUCTS.map((e) => [e.productCode, e]),
);

export function entitlementCatalogEntry(
  productCode: string,
): EntitlementCatalogEntry | undefined {
  return catalogIndex.get(productCode);
}

// ---------- reputation fact types (D-225-5) ----------

export const FACT_TYPES = [
  "TASK_COMPLETED",
  "SUBMISSION_ACCEPTED",
  "EVIDENCE_SUPPLIED",
  "PAYMENT_VERIFIED",
  "DISPUTE",
  "ATTESTATION",
] as const;
export type FactType = (typeof FACT_TYPES)[number];

// ---------- typed domain error ----------

export type IdentityErrorCode =
  | "NOT_FOUND" // 404 — actor/entitlement missing
  | "INVALID" // 400 — contract guard (shape/catalog)
  | "CONFLICT"; // 409 — stale row / transition rejected

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  readonly httpStatus: number;
  readonly detail?: unknown;

  constructor(
    code: IdentityErrorCode,
    message: string,
    httpStatus: number,
    detail?: unknown,
  ) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail;
  }
}

export const notFound = (what: string, id: string): IdentityError =>
  new IdentityError("NOT_FOUND", `${what} ${id} not found`, 404);

export const invalid = (message: string, detail?: unknown): IdentityError =>
  new IdentityError("INVALID", message, 400, detail);

export const conflict = (message: string, detail?: unknown): IdentityError =>
  new IdentityError("CONFLICT", message, 409, detail);
