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
  validateProductMetadata,
} from "../commerce-catalog";

import { submitAttempt } from "./attempt";
import type { CreateAttemptInput, CreateAttemptResult } from "./attempt";
import { CheckoutError } from "./errors";
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

function defaultId(prefix: string): string {
  return `${prefix}_${
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}_${Math.random().toString(36).slice(2)}`
  }`;
}

/** Stable fingerprint — same convention as PaymentService so later
 *  service-side dedupe reads stay compatible. */
function checkoutFingerprint(input: {
  reference: string;
  amount: string;
  productCode: string;
  customerId?: string;
  agentId?: string;
}): string {
  return JSON.stringify({
    reference: input.reference,
    amount: input.amount,
    currency: "USD",
    purpose: "checkout",
    productId: input.productCode,
    customerId: input.customerId ?? null,
    agentId: input.agentId ?? null,
  });
}

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
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new CheckoutError(
        "invalid_quantity",
        400,
        "quantity must be an integer 1..1000",
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

    const reference = `chk_${
      input.idempotencyKey ?? this.newId("ref").slice(4)
    }`;
    if (input.idempotencyKey != null) {
      const dup =
        (await this.stores.payments.getByIdempotencyKey(
          input.idempotencyKey,
        )) ?? (await this.stores.payments.getByReference(reference));
      if (dup) return { payment: dup, deduped: true };
    }

    const at = this.now();
    const fingerprint = checkoutFingerprint({
      reference,
      amount,
      productCode: product.productCode,
      customerId: input.customerId,
      agentId: input.agentId,
    });
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
      expiresAtMs: null,
      createdAtMs: at.getTime(),
      updatedAtMs: at.getTime(),
      payload: {
        request: fingerprint,
        productCode: product.productCode,
        quantity,
        metadata,
      },
    });
    if (!row) {
      const winner = await this.stores.payments.getByReference(reference);
      if (!winner) {
        throw new Error("payment insert deduped but row not found");
      }
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

  /** Domain-service confirm — verification pipeline + receipt (221-2
   *  test/support path; production confirm rides webhooks/engine). */
  async confirmPayment(
    input: Parameters<PaymentService["confirmPayment"]>[0],
  ) {
    return this.service.confirmPayment(input);
  }
}
