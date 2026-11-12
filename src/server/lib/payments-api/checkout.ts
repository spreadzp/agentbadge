/**
 * PaymentsCheckout — checkout orchestration over @agentbadge/payments
 * (EPIC-221, SLICE-221-2, D-221-1/D-221-6/D-221-8).
 *
 * The public API splits what PaymentService.createPayment does
 * atomically: POST /payments creates a PENDING row (no rail bound),
 * POST /payments/:id/attempts binds provider+network and submits to
 * the rail (see attempt.ts for the rail-side invariants it preserves).
 *
 *  - createPayment: catalog product + metadataSchema are validated
 *    BEFORE any row exists — no "paid but no fulfillment data" state
 *    (D-221-8). Amount = catalog USD price × quantity, integer-cents
 *    math (D-220 money rule). Idempotent via caller-supplied key.
 *  - createAttempt → attempt.ts submitAttempt.
 *  - reads delegate to an internal PaymentService for lazy expiry;
 *    confirmPayment reuses its verification+receipt pipeline.
 */

import {
  PaymentService,
  PaymentProviderRegistry,
  attemptFromRow,
  type Payment,
  type PaymentAttempt,
  type PaymentServiceStores,
  type PersistedPayment,
} from "@agentbadge/payments";

import {
  getCommerceProduct,
  sanitizeProductMetadata,
  validateProductMetadata,
} from "../commerce-catalog";

import { submitAttempt } from "./attempt";
import type { CreateAttemptInput, CreateAttemptResult } from "./attempt";
import { listPaymentExceptions } from "./checkout-exceptions";
import type { ListExceptionsOpts } from "./checkout-exceptions";
import {
  assertIdempotentReplay,
  checkoutFingerprint,
  defaultId,
  PAYMENT_TTL_MS,
} from "./checkout-idempotency";
import { CheckoutError } from "./errors";
import type { FulfillmentInput } from "./fulfillment";
import { multiplyUsdDecimal } from "./money";
import type { UsdcNetworks } from "./usdc-provider";

export { CheckoutError } from "./errors";
export type { CheckoutErrorCode } from "./errors";
export { multiplyUsdDecimal } from "./money";
export type { CreateAttemptInput, CreateAttemptResult } from "./attempt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaymentsCheckoutDeps {
  stores: PaymentServiceStores;
  providers: PaymentProviderRegistry;
  usdcNetworks: UsdcNetworks;
  usdcInstructionsTtlSec: number;
  now?: () => Date;
  newId?: (prefix: string) => string;
}

export interface CreatePaymentInput {
  productCode: string;
  quantity?: number;
  metadata?: unknown;
  customerId?: string;
  agentId?: string;
  idempotencyKey?: string;
}

export interface CreatePaymentResult {
  payment: PersistedPayment;
  deduped: boolean;
}

/** Stable fingerprint — same convention as PaymentService so later
 *  service-side dedupe reads stay compatible. */

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export class PaymentsCheckout {
  private readonly stores: PaymentServiceStores;
  private readonly providers: PaymentProviderRegistry;
  private readonly usdcNetworks: UsdcNetworks;
  private readonly usdcInstructionsTtlSec: number;
  private readonly now: () => Date;
  private readonly newId: (prefix: string) => string;
  /** Domain service reused for lazy-expiry reads and confirm/receipt. */
  private readonly service: PaymentService;

  constructor(deps: PaymentsCheckoutDeps) {
    this.stores = deps.stores;
    this.providers = deps.providers;
    this.usdcNetworks = deps.usdcNetworks;
    this.usdcInstructionsTtlSec = deps.usdcInstructionsTtlSec;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? defaultId;
    this.service = new PaymentService({
      stores: deps.stores,
      providers: deps.providers,
      now: this.now,
      newId: this.newId,
    });
  }

  // ------------------------------------------------------------ create

  /**
   * POST /payments — PENDING row only. Metadata is validated against the
   * catalog schema BEFORE create (D-221-8): no "paid but no fulfillment
   * data" state is possible.
   */
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const product = getCommerceProduct(input.productCode);
    if (!product || !product.active) {
      throw new CheckoutError(
        "unknown_product",
        400,
        `unknown or inactive productCode: ${input.productCode}`,
      );
    }
    const metadata = input.metadata ?? {};
    const validation = validateProductMetadata(product.productCode, metadata);
    if (!validation.ok) {
      throw new CheckoutError(
        "invalid_metadata",
        400,
        `metadata failed ${product.productCode} schema`,
        validation.errors,
      );
    }
    const quantity = input.quantity ?? 1;
    // M-5: catalog products are single-entitlement — quantity > 1 would
    // multiply the charge for one fulfillment.
    if (quantity !== 1) {
      throw new CheckoutError(
        "invalid_quantity",
        400,
        "quantity must be 1 — catalog products are single-entitlement",
      );
    }
    const usd = product.prices.find((p) => p.currency === "USD" && p.active);
    if (!usd) {
      throw new CheckoutError(
        "no_usd_price",
        400,
        `product ${product.productCode} has no active USD price`,
      );
    }
    const amount = multiplyUsdDecimal(usd.amount, quantity);

    const reference = `chk_${input.idempotencyKey ?? this.newId("ref").slice(4)
      }`;

    const at = this.now();
    const fingerprint = checkoutFingerprint({
      reference,
      amount,
      productCode: product.productCode,
      customerId: input.customerId,
      agentId: input.agentId,
    });
    if (input.idempotencyKey != null) {
      const dup =
        (await this.stores.payments.getByIdempotencyKey(
          input.idempotencyKey,
        )) ?? (await this.stores.payments.getByReference(reference));
      if (dup) {
        assertIdempotentReplay(dup, fingerprint, input.idempotencyKey);
        return { payment: dup, deduped: true };
      }
    }

    const row = await this.stores.payments.create({
      id: this.newId("pay"),
      reference,
      idempotencyKey: input.idempotencyKey ?? null,
      customerId: input.customerId ?? null,
      agentId: input.agentId ?? null,
      productId: product.productCode,
      orderId: null,
      amount,
      currency: "USD",
      status: "PENDING",
      purpose:
        product.fulfillmentKind === "passport-mint" ? "PASSPORT" : "CUSTOM",
      expiresAtMs: at.getTime() + PAYMENT_TTL_MS,
      createdAtMs: at.getTime(),
      updatedAtMs: at.getTime(),
      payload: {
        request: fingerprint,
        productCode: product.productCode,
        quantity,
        metadata: sanitizeProductMetadata(product.productCode, metadata),
      },
    });
    if (!row) {
      const winner = await this.stores.payments.getByReference(reference);
      if (!winner) {
        throw new Error("payment insert deduped but row not found");
      }
      assertIdempotentReplay(winner, fingerprint, input.idempotencyKey);
      return { payment: winner, deduped: true };
    }
    return { payment: row, deduped: false };
  }

  // ----------------------------------------------------------- attempt

  /** POST /payments/:id/attempts — see attempt.ts for the invariants. */
  async createAttempt(input: CreateAttemptInput): Promise<CreateAttemptResult> {
    return submitAttempt(
      {
        stores: this.stores,
        providers: this.providers,
        usdcNetworks: this.usdcNetworks,
        usdcInstructionsTtlSec: this.usdcInstructionsTtlSec,
        now: this.now,
        newId: this.newId,
      },
      input,
    );
  }

  // -------------------------------------------------------------- read

  async getPayment(id: string): Promise<Payment | null> {
    return this.service.getPayment(id);
  }

  async listAttempts(paymentId: string): Promise<PaymentAttempt[]> {
    const rows = await this.stores.attempts.listByPayment(paymentId);
    return rows.map(attemptFromRow);
  }

  async getReceipt(paymentId: string) {
    const receipts = await this.stores.receipts.listByPayment(paymentId);
    return receipts[receipts.length - 1] ?? null;
  }

  /** 222-4: ops exception feed — `null` when the persistence
   *  backend has no exceptions port (pre-222-4 stores). */
  async listExceptions(opts?: ListExceptionsOpts) {
    return listPaymentExceptions(this.stores, opts);
  }

  /** Domain-service confirm — verification pipeline + receipt (221-2
   *  test/support path; production confirm rides webhooks/engine). */
  async confirmPayment(
    input: Parameters<PaymentService["confirmPayment"]>[0],
  ) {
    return this.service.confirmPayment(input);
  }

  /** SLICE-221-3 (D-221-4): normalized registry input for a payment —
   *  productCode + buyer metadata + amount from the row payload. */
  async getFulfillmentInput(
    paymentId: string,
  ): Promise<FulfillmentInput | null> {
    const row = await this.stores.payments.getById(paymentId);
    if (!row) return null;
    const payload =
      typeof row.payload === "object" && row.payload !== null
        ? (row.payload as {
          productCode?: unknown;
          metadata?: unknown;
        })
        : {};
    const product = getCommerceProduct(
      typeof payload.productCode === "string"
        ? payload.productCode
        : (row.productId ?? ""),
    );
    return {
      productCode:
        typeof payload.productCode === "string"
          ? payload.productCode
          : (row.productId ?? "unknown"),
      buyerRef: row.customerId ?? row.agentId ?? undefined,
      metadata: {
        // Server-side binding: `tier` comes from the catalog product,
        // never from client metadata (passport-mint handlers require it).
        ...(typeof payload.metadata === "object" && payload.metadata !== null
          ? (payload.metadata as Record<string, unknown>)
          : {}),
        ...(product?.tier ? { tier: product.tier } : {}),
      },
      amountUsd: row.amount,
      paymentRef: row.id,
    };
  }
}
